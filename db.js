const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
  ssl: {
    rejectUnauthorized: false
  }
});

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255),
        password VARCHAR(255) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        account_name VARCHAR(100) NOT NULL,
        balance DECIMAL(10, 2) DEFAULT 0.00
      );

      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        document_name VARCHAR(255) NOT NULL,
        blob_url TEXT,
        status VARCHAR(50) DEFAULT 'Pending',
        extracted_age INTEGER,
        insurance_premium DECIMAL(10, 2),
        email_queued_at TIMESTAMPTZ
      );
    `);
    
    // Check if we need to add user_id to accounts (if it was created previously)
    try {
      await pool.query('ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id)');
    } catch (e) {
      // Column might already exist or table doesn't have it, ignore
    }

    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)');
    await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS extracted_age INTEGER');
    await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS insurance_premium DECIMAL(10, 2)');
    await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT \'Pending\'');
    await pool.query('ALTER TABLE documents ADD COLUMN IF NOT EXISTS email_queued_at TIMESTAMPTZ');
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  initDB
};
