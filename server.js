const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Ensure DB folder exists
if (!fs.existsSync('./db')) fs.mkdirSync('./db');

// Database setup
const db = new sqlite3.Database('./db/stock.db', (err) => {
  db.serialize();
  if (err) return console.error(err.message);
  console.log('Connected to the SQLite database.');
});

// Create tables and handle migrations
const setupDB = () => {
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
    FOREIGN KEY (product_id) REFERENCES Product(id)
  )`);

  // Check if supplier column exists, if not add it
  db.all("PRAGMA table_info(Product)", (err, rows) => {
    if (err) {
      console.error('Error checking table structure:', err);
      return;
    }
    
    const hasSupplierColumn = rows.some(row => row.name === 'supplier');
    
    if (!hasSupplierColumn) {
      db.run("ALTER TABLE Product ADD COLUMN supplier TEXT", (err) => {
        if (err) {
          console.error('Error adding supplier column:', err);
        } else {
          console.log('Successfully added supplier column to Product table');
        }
      });
    }
  });
};

setupDB();

// Middleware
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// === API ===

// Get current stock with all needed fields
app.get('/api/stock', (req, res) => {
  const sql = `SELECT 
                Product.name as product, 
                Product.product_type as type,
                CASE WHEN Product.is_organic = 1 THEN 'Yes' ELSE 'No' END as organic,
                Product.supplier,
                Product.cost_price,
                SUM(Delivery.delivery_amount) as amount,
                MAX(Delivery.delivery_date) as delivery_date,
                (SELECT delivery_amount FROM Delivery WHERE product_id = Product.id ORDER BY delivery_date DESC LIMIT 1) as delivery_amount
               FROM Product
               JOIN Delivery ON Product.id = Delivery.product_id
               WHERE Delivery.delivery_amount > 0
               GROUP BY Product.name
               ORDER BY Product.name`;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

// NEW: Get products for dropdown
app.get('/api/products', (req, res) => {
  const sql = `SELECT DISTINCT Product.name as product
               FROM Product
               JOIN Delivery ON Product.id = Delivery.product_id
               ORDER BY Product.name`;

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error(err);
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

// Add stock with supplier field
app.post('/api/add', (req, res) => {
  const { product, type, organic, supplier, cost_price, delivery_date, delivery_amount } = req.body;

  db.serialize(() => {
    db.run(`INSERT OR IGNORE INTO Product (name, product_type, is_organic, cost_price, supplier)
            VALUES (?, ?, ?, ?, ?)`,
      [product, type, organic === 'yes' ? 1 : 0, cost_price, supplier], function (err) {
      if (err) return res.status(500).json({ error: 'Failed to insert product' });

      db.get(`SELECT id FROM Product WHERE name = ?`, [product], (err, row) => {
        if (err || !row) return res.status(500).json({ error: 'Failed to retrieve product ID' });

        db.run(`INSERT INTO Delivery (product_id, delivery_date, delivery_amount)
                VALUES (?, ?, ?)`,
          [row.id, delivery_date, delivery_amount], (err) => {
            if (err) return res.status(500).json({ error: 'Failed to insert delivery' });
            res.json({ success: true });
        });
      });
    });
  });
});

// Use stock (reduce by amount) - MODIFIED: Allow negative stock
app.post('/api/used', (req, res) => {
  const { product, amount } = req.body;

  db.get(`SELECT id FROM Product WHERE name = ?`, [product], (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'Product not found' });

    const productId = row.id;

    db.all(`SELECT * FROM Delivery WHERE product_id = ? ORDER BY delivery_date ASC`, [productId], (err, deliveries) => {
      if (err || !deliveries.length) return res.status(400).json({ error: 'No deliveries to deduct from' });

      let remaining = amount;
      const updates = [];

      for (const delivery of deliveries) {
        if (remaining <= 0) break;
        const deduction = Math.min(remaining, delivery.delivery_amount);
        remaining -= deduction;
        updates.push({ id: delivery.id, newAmount: delivery.delivery_amount - deduction });
      }

      // MODIFIED: Continue even if not enough stock (allows negative)
      if (remaining > 0) {
        // Add a negative delivery to handle the shortage
        db.run(`INSERT INTO Delivery (product_id, delivery_date, delivery_amount)
                VALUES (?, date('now'), ?)`,
          [productId, -remaining], (err) => {
            if (err) return res.status(500).json({ error: 'Error handling stock shortage' });
            
            // Continue with regular updates
            const updateNext = () => {
              const next = updates.shift();
              if (!next) return res.json({ success: true });
              db.run(`UPDATE Delivery SET delivery_amount = ? WHERE id = ?`, [next.newAmount, next.id], (err) => {
                if (err) return res.status(500).json({ error: 'Error updating stock' });
                updateNext();
              });
            };
            updateNext();
        });
      } else {
        // Regular stock deduction
        const updateNext = () => {
          const next = updates.shift();
          if (!next) return res.json({ success: true });
          db.run(`UPDATE Delivery SET delivery_amount = ? WHERE id = ?`, [next.newAmount, next.id], (err) => {
            if (err) return res.status(500).json({ error: 'Error updating stock' });
            updateNext();
          });
        };
        updateNext();
      }
    });
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});