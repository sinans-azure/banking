require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const blobStorage = require('./blob');
const mailQueue = require('./mailQueue');

const app = express();
const port = process.env.PORT || 8080;
const sessionSecret = process.env.SESSION_SECRET || 'azure-banking-super-secret';
const isProduction = process.env.NODE_ENV === 'production';

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction
  }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  next();
};

const normalizeOcrResult = (payload) => ({
  extractedAge: payload.extractedAge ?? payload.extracted_age ?? payload.age ?? null,
  insurancePremium: payload.insurancePremium ?? payload.insurance_premium ?? payload.premium ?? null,
  status: payload.status || 'Processed'
});

const updateDocumentOcrResult = async ({ documentId, blobUrl, status, extractedAge, insurancePremium }) => {
  if (documentId) {
    const result = await db.query(
      `UPDATE documents
       SET status = $1, extracted_age = $2, insurance_premium = $3
       WHERE id = $4
       RETURNING id`,
      [status, extractedAge, insurancePremium, documentId]
    );
    return result.rowCount;
  }

  const result = await db.query(
    `UPDATE documents
     SET status = $1, extracted_age = $2, insurance_premium = $3
     WHERE blob_url = $4
     RETURNING id`,
    [status, extractedAge, insurancePremium, blobUrl]
  );
  return result.rowCount;
};

const queueOcrEmailNotification = async (documentId) => {
  const result = await db.query(
    `SELECT
       d.id,
       d.document_name,
       d.status,
       d.extracted_age,
       d.insurance_premium,
       d.email_queued_at,
       u.username,
       u.email
     FROM documents d
     JOIN users u ON u.id = d.user_id
     WHERE d.id = $1`,
    [documentId]
  );

  if (result.rows.length === 0) return false;

  const document = result.rows[0];
  if (document.email_queued_at || document.status === 'Processing' || document.status === 'Pending Validation') {
    return false;
  }

  const queued = await mailQueue.enqueueOcrEmail({
    email: document.email,
    username: document.username,
    documentName: document.document_name,
    status: document.status,
    extractedAge: document.extracted_age,
    insurancePremium: document.insurance_premium
  });

  if (queued) {
    await db.query('UPDATE documents SET email_queued_at = NOW() WHERE id = $1', [document.id]);
  }

  return queued;
};

// Auth Routes
app.get('/login', (req, res) => {
  res.render('login', { error: req.query.error, success: req.query.success });
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  try {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const userRes = await db.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) throw new Error('Invalid credentials');
    
    const user = userRes.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error('Invalid credentials');
    
    req.session.userId = user.id;
    res.redirect('/');
  } catch (error) {
    console.error('Login failed:', error.message);
    res.redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }
});

app.get('/register', (req, res) => {
  res.render('register', { error: req.query.error });
});

app.post('/register', async (req, res) => {
  const username = (req.body.username || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  let transactionStarted = false;

  try {
    if (!username || !email || !password) {
      throw new Error('Username, email, and password are required');
    }
    if (!email.endsWith('@gmail.com')) {
      throw new Error('Please use a Gmail address for email notifications');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    await db.query('BEGIN');
    transactionStarted = true;

    const hashed = await bcrypt.hash(password, 10);
    const newRes = await db.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
      [username, email, hashed]
    );
    const newUserId = newRes.rows[0].id;
    
    // Give them a default account
    await db.query('INSERT INTO accounts (user_id, account_name, balance) VALUES ($1, $2, $3)', [newUserId, 'Main Checking', 1000.00]);

    await db.query('COMMIT');
    
    res.redirect('/login?success=Registration successful! Please log in.');
  } catch (error) {
    if (transactionStarted) {
      await db.query('ROLLBACK');
    }

    const message = error.code === '23505'
      ? 'Registration failed. Username already exists.'
      : error.message;

    console.error('Registration failed:', error.message);
    res.redirect(`/register?error=${encodeURIComponent(message)}`);
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Routes
app.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userRes = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
    const username = userRes.rows[0].username;

    const accountsResult = await db.query('SELECT * FROM accounts WHERE user_id = $1 ORDER BY id', [userId]);
    const documentsResult = await db.query('SELECT * FROM documents WHERE user_id = $1 ORDER BY id DESC', [userId]);
    
    // Also fetch all accounts for the 'To Account' dropdown in transfer
    const allAccountsResult = await db.query('SELECT * FROM accounts ORDER BY id');
    
    res.render('index', {
      username: username,
      accounts: accountsResult.rows,
      allAccounts: allAccountsResult.rows,
      documents: documentsResult.rows,
      error: req.query.error,
      success: req.query.success
    });
  } catch (error) {
    console.error(error);
    res.render('index', {
      username: 'Unknown',
      accounts: [],
      allAccounts: [],
      documents: [],
      error: 'Failed to load dashboard data. ' + error.message,
      success: null
    });
  }
});

app.post('/transfer', requireAuth, async (req, res) => {
  const { from_id, to_id, amount } = req.body;
  const transferAmount = parseFloat(amount);
  const userId = req.session.userId;
  let transactionStarted = false;

  try {
    if (!Number.isFinite(transferAmount) || transferAmount <= 0) {
      throw new Error('Amount must be greater than zero');
    }
    if (from_id === to_id) {
      throw new Error('Choose a different destination account');
    }

    await db.query('BEGIN');
    transactionStarted = true;
    
    // Check balance and ownership
    const senderRes = await db.query('SELECT balance, user_id FROM accounts WHERE id = $1', [from_id]);
    if (senderRes.rows.length === 0) {
      throw new Error('Invalid account');
    }
    if (senderRes.rows[0].user_id !== userId) {
      throw new Error('You do not own this account');
    }
    if (parseFloat(senderRes.rows[0].balance) < transferAmount) {
      throw new Error('Insufficient funds');
    }

    // Deduct from sender
    await db.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [transferAmount, from_id]);
    
    // Add to receiver
    await db.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [transferAmount, to_id]);
    
    await db.query('COMMIT');
    
    res.redirect('/?success=Transfer successful');
  } catch (error) {
    if (transactionStarted) {
      await db.query('ROLLBACK');
    }
    res.redirect(`/?error=Transfer failed: ${error.message}`);
  }
});

app.post('/upload', requireAuth, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }
    
    const userId = req.session.userId;
    const blobUrl = await blobStorage.uploadDocument(req.file.originalname, req.file.buffer, userId);
    
    // Save document record to DB
    await db.query(
      'INSERT INTO documents (user_id, document_name, blob_url, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, req.file.originalname, blobUrl, 'Pending Validation']
    );

    res.redirect('/?success=Document uploaded successfully. OCR processing will begin shortly.');
  } catch (error) {
    res.redirect(`/?error=Upload failed: ${error.message}`);
  }
});

// API endpoint for Azure Function to update OCR results
app.post('/api/ocr-result', async (req, res) => {
  if (process.env.OCR_WEBHOOK_SECRET) {
    const providedSecret = req.get('x-ocr-webhook-secret');
    if (providedSecret !== process.env.OCR_WEBHOOK_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const result = normalizeOcrResult(req.body);
  const documentId = req.body.documentId || req.body.document_id;
  const blobUrl = req.body.blob_url || req.body.blobUrl;

  try {
    if (!documentId && !blobUrl) {
      return res.status(400).json({ error: 'documentId or blob_url is required' });
    }

    const updatedCount = await updateDocumentOcrResult({
      documentId,
      blobUrl,
      status: result.status,
      extractedAge: result.extractedAge,
      insurancePremium: result.insurancePremium
    });

    if (updatedCount === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const resolvedDocumentId = documentId || (await db.query('SELECT id FROM documents WHERE blob_url = $1', [blobUrl])).rows[0]?.id;
    const emailQueued = resolvedDocumentId ? await queueOcrEmailNotification(resolvedDocumentId) : false;

    res.status(200).json({ success: true, emailQueued });
  } catch (error) {
    console.error('OCR Webhook Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const start = async () => {
  await db.initDB();
  await blobStorage.initBlobStorage();
  mailQueue.initMailQueue();

  app.listen(port, () => {
    console.log(`Banking App listening at http://localhost:${port}`);
  });
};

start().catch((error) => {
  console.error('Failed to start Banking App:', error);
  process.exit(1);
});
