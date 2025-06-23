const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Create db folder
if (!fs.existsSync('./db')) fs.mkdirSync('./db');

// Connect SQLite db
const db = new sqlite3.Database('./db/stock.db', (err) => {
  if (err) {
    console.error('DB connection error:', err.message);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Setup tables
const setupDB = () => {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS Product (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      product_type TEXT,
      is_organic INTEGER,
      cost_price REAL,
      supplier TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS Delivery (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      delivery_date TEXT,
      delivery_amount INTEGER,
      FOREIGN KEY(product_id) REFERENCES Product(id)
    )`);
  });
};

setupDB();
// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

//  Get all products (for dropdown)
app.get('/api/products', (req, res) => {
  db.all(`SELECT name FROM Product ORDER BY name`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error getting products' });
    res.json(rows);
  });
});

// Get current stock
app.get('/api/stock', (req, res) => {
  const sql = `
    SELECT 
      P.name AS product,
      P.product_type AS type,
      P.supplier,
      P.cost_price,
      P.is_organic,
      SUM(D.delivery_amount) AS delivery_amount,
      MAX(D.delivery_date) AS delivery_date
    FROM Delivery D
    JOIN Product P ON P.id = D.product_id
    GROUP BY P.id
    ORDER BY P.name
  `;
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error('Error fetching stock:', err.message);
      return res.status(500).json({ error: 'DB error fetching stock' });
    }
    res.json(rows);
  });
});

// API: Add stock (product + delivery)
app.post('/api/add', (req, res) => {
  let { product, product_type, is_organic, supplier, cost_price, delivery_date, delivery_amount } = req.body;

  
  const fullName = (Number(is_organic) === 1) ? `${product} (Organic)` : `${product} (Non-Organic)`;

  // Insert or ignore product
  db.run(
    `INSERT OR IGNORE INTO Product (name, product_type, is_organic, cost_price, supplier) VALUES (?, ?, ?, ?, ?)`,
    [fullName, product_type, is_organic, cost_price, supplier],
    function(err) {
      if (err) return res.status(500).json({ error: 'Insert product failed' });

      // Get product id 
      const getId = () => {
        if (this.lastID) return Promise.resolve(this.lastID);
        return new Promise((resolve, reject) => {
          db.get(`SELECT id FROM Product WHERE name = ?`, [fullName], (err, row) => {
            if (err) reject(err);
            else resolve(row.id);
          });
        });
      };

      getId().then((productId) => {
        // Insert delivery record
        db.run(
          `INSERT INTO Delivery (product_id, delivery_date, delivery_amount) VALUES (?, ?, ?)`,
          [productId, delivery_date, delivery_amount],
          (err) => {
            if (err) return res.status(500).json({ error: 'Insert delivery failed' });
            res.json({ message: 'Delivery added successfully' });
          }
        );
      }).catch(err => {
        res.status(500).json({ error: 'Failed to get product ID' });
      });
    }
  );
});

app.post('/api/used', (req, res) => {
  const { product, amount } = req.body;
  res.json({ message: 'Stock usage recorded ' });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
