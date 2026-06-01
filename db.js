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
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        account_name VARCHAR(100) NOT NULL,
        balance DECIMAL(10, 2) DEFAULT 0.00
      );
    `);
    
    // Seed data if empty
    const res = await pool.query('SELECT COUNT(*) FROM accounts');
    if (parseInt(res.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO accounts (account_name, balance) VALUES 
        ('Alice Savings', 1500.50),
        ('Bob Checking', 250.00)
      `);
    }
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  initDB
};
