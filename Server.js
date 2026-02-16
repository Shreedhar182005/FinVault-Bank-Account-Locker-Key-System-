const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());


app.post("/api/accounts", async (req, res) => {
  try {
    const { acc_no, name, balance } = req.body;

    if (!acc_no || acc_no <= 0) return res.status(400).json({ msg: "Invalid acc_no" });
    if (!name || name.trim().length < 2) return res.status(400).json({ msg: "Invalid name" });

    const initBal = balance ? Number(balance) : 0;
    if (initBal < 0) return res.status(400).json({ msg: "Balance can't be negative" });

    const [exists] = await db.query("SELECT acc_no FROM accounts WHERE acc_no=?", [acc_no]);
    if (exists.length > 0) return res.status(409).json({ msg: "Account already exists" });

    await db.query("INSERT INTO accounts(acc_no, name, balance) VALUES(?,?,?)", [
      acc_no,
      name.trim(),
      initBal,
    ]);

    res.json({ msg: "Account created successfully" });
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});


app.get("/api/accounts", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT acc_no, name, balance, created_at FROM accounts ORDER BY acc_no");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});


app.get("/api/accounts/:acc_no", async (req, res) => {
  try {
    const acc_no = Number(req.params.acc_no);

    const [rows] = await db.query("SELECT acc_no, name, balance, created_at FROM accounts WHERE acc_no=?", [acc_no]);
    if (rows.length === 0) return res.status(404).json({ msg: "Account not found" });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

// ==========================
// 4) Deposit
// ==========================
app.post("/api/accounts/:acc_no/deposit", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const acc_no = Number(req.params.acc_no);
    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) return res.status(400).json({ msg: "Invalid amount" });

    await conn.beginTransaction();

    const [rows] = await conn.query("SELECT balance FROM accounts WHERE acc_no=? FOR UPDATE", [acc_no]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Account not found" });
    }

    const before = Number(rows[0].balance);
    const after = before + Number(amount);

    await conn.query("UPDATE accounts SET balance=? WHERE acc_no=?", [after, acc_no]);

    await conn.query(
      "INSERT INTO transactions(acc_no, type, amount, before_balance, after_balance) VALUES(?,?,?,?,?)",
      [acc_no, "DEPOSIT", amount, before, after]
    );

    await conn.commit();
    res.json({ msg: "Deposit successful", before, after });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ msg: "Server error", err: err.message });
  } finally {
    conn.release();
  }
});

// ==========================
// 5) Withdraw
// ==========================
app.post("/api/accounts/:acc_no/withdraw", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const acc_no = Number(req.params.acc_no);
    const { amount } = req.body;

    if (!amount || Number(amount) <= 0) return res.status(400).json({ msg: "Invalid amount" });

    await conn.beginTransaction();

    const [rows] = await conn.query("SELECT balance FROM accounts WHERE acc_no=? FOR UPDATE", [acc_no]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Account not found" });
    }

    const before = Number(rows[0].balance);
    if (Number(amount) > before) {
      await conn.rollback();
      return res.status(400).json({ msg: "Insufficient balance" });
    }

    const after = before - Number(amount);

    await conn.query("UPDATE accounts SET balance=? WHERE acc_no=?", [after, acc_no]);

    await conn.query(
      "INSERT INTO transactions(acc_no, type, amount, before_balance, after_balance) VALUES(?,?,?,?,?)",
      [acc_no, "WITHDRAW", amount, before, after]
    );

    await conn.commit();
    res.json({ msg: "Withdraw successful", before, after });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ msg: "Server error", err: err.message });
  } finally {
    conn.release();
  }
});

// ==========================
// 6) Delete Account
// ==========================
app.delete("/api/accounts/:acc_no", async (req, res) => {
  try {
    const acc_no = Number(req.params.acc_no);

    const [result] = await db.query("DELETE FROM accounts WHERE acc_no=?", [acc_no]);

    if (result.affectedRows === 0) return res.status(404).json({ msg: "Account not found" });

    res.json({ msg: "Account deleted" });
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

// ==========================
// 7) Get Transactions of an Account
// ==========================
app.get("/api/accounts/:acc_no/transactions", async (req, res) => {
  try {
    const acc_no = Number(req.params.acc_no);

    const [rows] = await db.query(
      "SELECT id, type, amount, before_balance, after_balance, created_at FROM transactions WHERE acc_no=? ORDER BY id DESC",
      [acc_no]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

// ==========================
// 8) Wipe All Data (DANGER)
// ==========================
app.delete("/api/wipe", async (req, res) => {
  try {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM lockers");
    await db.query("DELETE FROM accounts");
    res.json({ msg: "All data wiped" });
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

// ==========================
// 9) FULL UPDATE (Account No + Name)
// ==========================
// Old account number in URL
// Body: { new_acc_no, name }
app.put("/api/accounts/:old_acc_no/full-update", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const old_acc_no = Number(req.params.old_acc_no);
    const { new_acc_no, name } = req.body;

    if (!old_acc_no || old_acc_no <= 0) return res.status(400).json({ msg: "Invalid old account number" });
    if (!new_acc_no || new_acc_no <= 0) return res.status(400).json({ msg: "Invalid new account number" });
    if (!name || name.trim().length < 2) return res.status(400).json({ msg: "Invalid name" });

    await conn.beginTransaction();

    // old exists?
    const [oldRows] = await conn.query("SELECT acc_no FROM accounts WHERE acc_no=?", [old_acc_no]);
    if (oldRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Old account not found" });
    }

    // new acc conflict?
    if (new_acc_no !== old_acc_no) {
      const [newRows] = await conn.query("SELECT acc_no FROM accounts WHERE acc_no=?", [new_acc_no]);
      if (newRows.length > 0) {
        await conn.rollback();
        return res.status(409).json({ msg: "New account number already exists" });
      }
    }

    // update account
    // IMPORTANT: Requires ON UPDATE CASCADE in MySQL foreign keys
    await conn.query(
      "UPDATE accounts SET acc_no=?, name=? WHERE acc_no=?",
      [new_acc_no, name.trim(), old_acc_no]
    );

    await conn.commit();
    res.json({ msg: "Account updated (acc_no + name)" });

  } catch (err) {
    await conn.rollback();
    res.status(500).json({ msg: "Server error", err: err.message });
  } finally {
    conn.release();
  }
});

// ==========================
// 10) Create Locker (Random Key, never changes)
// ==========================
app.post("/api/accounts/:acc_no/locker", async (req, res) => {
  try {
    const acc_no = Number(req.params.acc_no);

    if (!acc_no || acc_no <= 0) return res.status(400).json({ msg: "Invalid account number" });

    // check account exists
    const [accRows] = await db.query("SELECT acc_no FROM accounts WHERE acc_no=?", [acc_no]);
    if (accRows.length === 0) return res.status(404).json({ msg: "Account not found" });

    // check locker already exists
    const [lockerRows] = await db.query("SELECT locker_key FROM lockers WHERE acc_no=?", [acc_no]);
    if (lockerRows.length > 0) {
      return res.status(409).json({ msg: "Locker already exists for this account" });
    }

    // generate random key (never changes)
    const key =
      "LOCK-" +
      Math.random().toString(36).slice(2, 10).toUpperCase() +
      "-" +
      Math.random().toString(36).slice(2, 10).toUpperCase();

    await db.query("INSERT INTO lockers(acc_no, locker_key) VALUES(?,?)", [acc_no, key]);

    res.json({ msg: "Locker created", locker_key: key });

  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});


app.get("/api/accounts/:acc_no/locker", async (req, res) => {
  try {
    const acc_no = Number(req.params.acc_no);

    const [rows] = await db.query(
      "SELECT acc_no, locker_key, created_at FROM lockers WHERE acc_no=?",
      [acc_no]
    );

    if (rows.length === 0) return res.status(404).json({ msg: "Locker not found" });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});


app.post("/api/locker/access", async (req, res) => {
  try {
    const { acc_no, locker_key } = req.body;

    if (!acc_no || acc_no <= 0) return res.status(400).json({ msg: "Invalid account number" });
    if (!locker_key || locker_key.length < 5) return res.status(400).json({ msg: "Invalid locker key" });

    const [rows] = await db.query(
      "SELECT acc_no FROM lockers WHERE acc_no=? AND locker_key=?",
      [acc_no, locker_key]
    );

    if (rows.length === 0) return res.status(401).json({ msg: "Wrong locker key" });

    res.json({ msg: "Locker access granted ✅" });

  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

// ==========================
// Server Start
// ==========================
app.listen(5000, () => console.log("Backend running on http://localhost:5000"));
