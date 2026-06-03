require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./db');
const blobStorage = require('./blob');

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

const buildAbsoluteUrl = (req, pathName) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  return `${protocol}://${req.get('host')}${pathName}`;
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

const callOcrFunction = async (req, document) => {
  if (!process.env.OCR_FUNCTION_URL) return null;

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.OCR_FUNCTION_KEY) {
    headers['x-functions-key'] = process.env.OCR_FUNCTION_KEY;
  }

  const response = await fetch(process.env.OCR_FUNCTION_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      documentId: document.id,
      userId: document.user_id,
      documentName: document.document_name,
      documentUrl: document.blob_url,
      callbackUrl: buildAbsoluteUrl(req, '/api/ocr-result')
    })
  });

  if (!response.ok) {
    throw new Error(`OCR Function returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  return normalizeOcrResult(await response.json());
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
  const password = req.body.password || '';
  let transactionStarted = false;

  try {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters');
    }

    await db.query('BEGIN');
    transactionStarted = true;

    const hashed = await bcrypt.hash(password, 10);
    const newRes = await db.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id', [username, hashed]);
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
    const documentResult = await db.query(
      'INSERT INTO documents (user_id, document_name, blob_url, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, req.file.originalname, blobUrl, process.env.OCR_FUNCTION_URL ? 'Processing' : 'Pending Validation']
    );

    const document = documentResult.rows[0];

    if (process.env.OCR_FUNCTION_URL) {
      try {
        const ocrResult = await callOcrFunction(req, document);
        if (ocrResult) {
          await updateDocumentOcrResult({
            documentId: document.id,
            status: ocrResult.status,
            extractedAge: ocrResult.extractedAge,
            insurancePremium: ocrResult.insurancePremium
          });
          return res.redirect('/?success=Document uploaded and insurance quote calculated.');
        }

        return res.redirect('/?success=Document uploaded. OCR Function accepted the request.');
      } catch (ocrError) {
        console.error('OCR Function Error:', ocrError);
        await db.query(
          'UPDATE documents SET status = $1 WHERE id = $2',
          ['OCR Failed', document.id]
        );
        return res.redirect(`/?error=Document uploaded, but OCR failed: ${ocrError.message}`);
      }
    }

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
  const blobUrl = req.body.blob_url || req.body.blobUrl || req.body.documentUrl;

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

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('OCR Webhook Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const start = async () => {
  await db.initDB();
  await blobStorage.initBlobStorage();

  app.listen(port, () => {
    console.log(`Banking App listening at http://localhost:${port}`);
  });
};

start().catch((error) => {
  console.error('Failed to start Banking App:', error);
  process.exit(1);
});
