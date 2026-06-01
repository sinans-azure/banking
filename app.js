require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const blobStorage = require('./blob');

const app = express();
const port = process.env.PORT || 8080;

// Configure multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize DB and Storage
db.initDB();
blobStorage.initBlobStorage();

// Routes
app.get('/', async (req, res) => {
  try {
    const accountsResult = await db.query('SELECT * FROM accounts ORDER BY id');
    const documents = await blobStorage.listDocuments();
    
    res.render('index', {
      accounts: accountsResult.rows,
      documents: documents,
      error: null,
      success: null
    });
  } catch (error) {
    console.error(error);
    res.render('index', {
      accounts: [],
      documents: [],
      error: 'Failed to load dashboard data. ' + error.message,
      success: null
    });
  }
});

app.post('/transfer', async (req, res) => {
  const { from_id, to_id, amount } = req.body;
  const transferAmount = parseFloat(amount);

  try {
    await db.query('BEGIN');
    
    // Check balance
    const senderRes = await db.query('SELECT balance FROM accounts WHERE id = $1', [from_id]);
    if (senderRes.rows.length === 0 || parseFloat(senderRes.rows[0].balance) < transferAmount) {
      throw new Error('Insufficient funds or invalid account');
    }

    // Deduct from sender
    await db.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [transferAmount, from_id]);
    
    // Add to receiver
    await db.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [transferAmount, to_id]);
    
    await db.query('COMMIT');
    
    res.redirect('/?success=Transfer successful');
  } catch (error) {
    await db.query('ROLLBACK');
    res.redirect(`/?error=Transfer failed: ${error.message}`);
  }
});

app.post('/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      throw new Error('No file uploaded');
    }
    
    await blobStorage.uploadDocument(req.file.originalname, req.file.buffer);
    res.redirect('/?success=Document uploaded successfully to Azure Blob Storage');
  } catch (error) {
    res.redirect(`/?error=Upload failed: ${error.message}`);
  }
});

app.listen(port, () => {
  console.log(`Banking App listening at http://localhost:${port}`);
});
