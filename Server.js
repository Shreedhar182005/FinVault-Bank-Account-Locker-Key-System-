const express = require("express");
const cors = require("cors");
const db = require("./db");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 5000;

function genLockerKey() {
  return (
    "LOCK-" +
    Math.random().toString(36).slice(2, 10).toUpperCase() +
    "-" +
    Math.random().toString(36).slice(2, 10).toUpperCase()
  );
}

async function genNewAccountNo() {
  const [rows] = await db.query("SELECT MAX(acc_no) AS mx FROM accounts");
  const mx = rows[0]?.mx ? Number(rows[0].mx) : 1000;
  return mx + 1;
}

function safeJsonParse(s) {
  try {
    if (!s) return null;
    if (typeof s === "object") return s; // if already object
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalizeType(x) {
  return String(x || "").trim().toUpperCase();
}

/* ---------------- HEALTH ---------------- */

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, msg: "API + MySQL OK" });
  } catch (err) {
    res.status(500).json({ ok: false, msg: "MySQL error", err: err.message });
  }
});

/* ---------------- ACCOUNTS ---------------- */

app.get("/api/accounts", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT acc_no, name, balance, created_at FROM accounts ORDER BY acc_no"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

app.get("/api/accounts/:acc_no", async (req, res) => {
  try {
    const acc_no = Number(req.params.acc_no);

    const [rows] = await db.query(
      "SELECT acc_no, name, balance, created_at FROM accounts WHERE acc_no=?",
      [acc_no]
    );

    if (rows.length === 0) return res.status(404).json({ msg: "Account not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

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

/* ---------------- DEPOSIT ---------------- */

app.post("/api/accounts/:acc_no/deposit", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const acc_no = Number(req.params.acc_no);
    const amount = Number(req.body.amount);

    if (!acc_no || acc_no <= 0) return res.status(400).json({ msg: "Invalid acc_no" });
    if (!amount || amount <= 0) return res.status(400).json({ msg: "Invalid amount" });

    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT balance FROM accounts WHERE acc_no=? FOR UPDATE",
      [acc_no]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Account not found" });
    }

    const before = Number(rows[0].balance);
    const after = before + amount;

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

/* ---------------- WITHDRAW ---------------- */

app.post("/api/accounts/:acc_no/withdraw", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const acc_no = Number(req.params.acc_no);
    const amount = Number(req.body.amount);

    if (!acc_no || acc_no <= 0) return res.status(400).json({ msg: "Invalid acc_no" });
    if (!amount || amount <= 0) return res.status(400).json({ msg: "Invalid amount" });

    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT balance FROM accounts WHERE acc_no=? FOR UPDATE",
      [acc_no]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Account not found" });
    }

    const before = Number(rows[0].balance);
    if (amount > before) {
      await conn.rollback();
      return res.status(400).json({ msg: "Insufficient balance" });
    }

    const after = before - amount;

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

/* ---------------- TRANSACTIONS ---------------- */

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

/* ---------------- FULL UPDATE (ADMIN DIRECT) ---------------- */

app.put("/api/accounts/:old_acc_no/full-update", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const old_acc_no = Number(req.params.old_acc_no);
    const new_acc_no = Number(req.body.new_acc_no);
    const name = String(req.body.name || "").trim();

    if (!old_acc_no || old_acc_no <= 0) return res.status(400).json({ msg: "Invalid old acc_no" });
    if (!new_acc_no || new_acc_no <= 0) return res.status(400).json({ msg: "Invalid new acc_no" });
    if (name.length < 2) return res.status(400).json({ msg: "Invalid name" });

    await conn.beginTransaction();

    const [oldRows] = await conn.query("SELECT acc_no FROM accounts WHERE acc_no=?", [old_acc_no]);
    if (oldRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Old account not found" });
    }

    if (new_acc_no !== old_acc_no) {
      const [newRows] = await conn.query("SELECT acc_no FROM accounts WHERE acc_no=?", [new_acc_no]);
      if (newRows.length > 0) {
        await conn.rollback();
        return res.status(409).json({ msg: "New account number already exists" });
      }
    }

    await conn.query("UPDATE accounts SET acc_no=?, name=? WHERE acc_no=?", [
      new_acc_no,
      name,
      old_acc_no
    ]);

    // keep data consistent
    if (new_acc_no !== old_acc_no) {
      await conn.query("UPDATE transactions SET acc_no=? WHERE acc_no=?", [new_acc_no, old_acc_no]);
      await conn.query("UPDATE lockers SET acc_no=? WHERE acc_no=?", [new_acc_no, old_acc_no]);
      await conn.query("UPDATE requests SET acc_no=? WHERE acc_no=?", [new_acc_no, old_acc_no]);
    }

    await conn.commit();
    res.json({ msg: "Account updated successfully" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ msg: "Server error", err: err.message });
  } finally {
    conn.release();
  }
});

/* ---------------- LOCKERS ---------------- */

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
    const acc_no = Number(req.body.acc_no);
    const locker_key = String(req.body.locker_key || "").trim();

    if (!acc_no || acc_no <= 0) return res.status(400).json({ msg: "Invalid account number" });
    if (!locker_key || locker_key.length < 8)
      return res.status(400).json({ msg: "Invalid locker key" });

    const [rows] = await db.query(
      "SELECT acc_no FROM lockers WHERE acc_no=? AND locker_key=?",
      [acc_no, locker_key]
    );

    if (rows.length === 0) return res.status(401).json({ msg: "Wrong locker key" });

    res.json({ msg: "Locker access granted" });
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

/* ---------------- REQUESTS ---------------- */

app.post("/api/requests", async (req, res) => {
  try {
    const request_type = normalizeType(req.body.request_type);
    const acc_no = req.body.acc_no === undefined ? null : Number(req.body.acc_no);
    const payload = req.body.payload || null;

    if (!request_type) return res.status(400).json({ msg: "Request type required" });

    // CREATE ACCOUNT (no acc_no needed)
    if (request_type === "CREATE_ACCOUNT") {
      const p = payload || {};
      const name = String(p.name || "").trim();
      const opening = Number(p.opening_balance || 0);

      if (name.length < 2) return res.status(400).json({ msg: "Invalid name" });
      if (isNaN(opening) || opening < 0)
        return res.status(400).json({ msg: "Invalid opening balance" });

      await db.query(
        "INSERT INTO requests(acc_no, request_type, payload) VALUES(NULL,?,?)",
        ["CREATE_ACCOUNT", JSON.stringify({ name, opening_balance: opening })]
      );

      return res.json({ msg: "Account opening request submitted" });
    }

    // For other requests acc_no must exist
    if (!acc_no || acc_no <= 0) return res.status(400).json({ msg: "Invalid acc_no" });

    const [accRows] = await db.query("SELECT acc_no FROM accounts WHERE acc_no=?", [acc_no]);
    if (accRows.length === 0) return res.status(404).json({ msg: "Account not found" });

    // prevent duplicate pending same type
    const [pending] = await db.query(
      "SELECT id FROM requests WHERE acc_no=? AND request_type=? AND status='PENDING'",
      [acc_no, request_type]
    );

    if (pending.length > 0) return res.status(409).json({ msg: "Request already pending" });

    await db.query(
      "INSERT INTO requests(acc_no, request_type, payload) VALUES(?,?,?)",
      [acc_no, request_type, payload ? JSON.stringify(payload) : null]
    );

    res.json({ msg: "Request submitted successfully" });
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

app.get("/api/requests", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, acc_no, request_type, payload, status, created_at FROM requests ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

app.put("/api/requests/:id", async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = Number(req.params.id);
    const action = normalizeType(req.body.action);

    if (!id) return res.status(400).json({ msg: "Invalid request id" });
    if (action !== "APPROVE" && action !== "REJECT")
      return res.status(400).json({ msg: "Invalid action" });

    await conn.beginTransaction();

    const [reqRows] = await conn.query(
      "SELECT id, acc_no, request_type, payload, status FROM requests WHERE id=? FOR UPDATE",
      [id]
    );

    if (reqRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ msg: "Request not found" });
    }

    const R = reqRows[0];
    const type = normalizeType(R.request_type);

    if (R.status !== "PENDING") {
      await conn.rollback();
      return res.status(400).json({ msg: "Request already processed" });
    }

    // reject
    if (action === "REJECT") {
      await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
      await conn.commit();
      return res.json({ msg: "Request rejected" });
    }

    /* -------- APPROVE LOGIC -------- */

    // CREATE_ACCOUNT
    if (type === "CREATE_ACCOUNT") {
      const payload = safeJsonParse(R.payload);

      if (!payload || !payload.name) {
        await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
        await conn.commit();
        return res.status(400).json({ msg: "Invalid payload. Request rejected." });
      }

      const name = String(payload.name || "").trim();
      const opening = Number(payload.opening_balance || 0);

      if (name.length < 2 || isNaN(opening) || opening < 0) {
        await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
        await conn.commit();
        return res.status(400).json({ msg: "Invalid account data. Request rejected." });
      }

      const newAccNo = await genNewAccountNo();

      await conn.query("INSERT INTO accounts(acc_no, name, balance) VALUES(?,?,?)", [
        newAccNo,
        name,
        opening
      ]);

      await conn.query(
        "INSERT INTO transactions(acc_no, type, amount, before_balance, after_balance) VALUES(?,?,?,?,?)",
        [newAccNo, "OPEN", opening, 0, opening]
      );

      await conn.query("UPDATE requests SET status='APPROVED', acc_no=? WHERE id=?", [
        newAccNo,
        id
      ]);

      await conn.commit();
      return res.json({ msg: "Account request approved", acc_no: newAccNo });
    }

    // CREATE_LOCKER
    if (type === "CREATE_LOCKER") {
      const acc_no = Number(R.acc_no);

      const [lockerRows] = await conn.query("SELECT id FROM lockers WHERE acc_no=?", [acc_no]);
      if (lockerRows.length > 0) {
        await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
        await conn.commit();
        return res.status(409).json({ msg: "Locker already exists. Request rejected." });
      }

      const key = genLockerKey();
      await conn.query("INSERT INTO lockers(acc_no, locker_key) VALUES(?,?)", [acc_no, key]);
      await conn.query("UPDATE requests SET status='APPROVED' WHERE id=?", [id]);

      await conn.commit();
      return res.json({ msg: "Locker request approved", locker_key: key });
    }

    // UPDATE_ACCOUNT
    if (type === "UPDATE_ACCOUNT") {
      const payload = safeJsonParse(R.payload);

      if (!payload || !payload.new_acc_no || !payload.new_name) {
        await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
        await conn.commit();
        return res.status(400).json({ msg: "Invalid payload. Request rejected." });
      }

      const old_acc_no = Number(R.acc_no);
      const new_acc_no = Number(payload.new_acc_no);
      const new_name = String(payload.new_name || "").trim();

      if (!new_acc_no || new_acc_no <= 0 || new_name.length < 2) {
        await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
        await conn.commit();
        return res.status(400).json({ msg: "Invalid update values. Request rejected." });
      }

      if (new_acc_no !== old_acc_no) {
        const [newRows] = await conn.query("SELECT acc_no FROM accounts WHERE acc_no=?", [new_acc_no]);
        if (newRows.length > 0) {
          await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
          await conn.commit();
          return res.status(409).json({ msg: "New account number already exists. Request rejected." });
        }
      }

      await conn.query("UPDATE accounts SET acc_no=?, name=? WHERE acc_no=?", [
        new_acc_no,
        new_name,
        old_acc_no
      ]);

      // keep related data consistent
      if (new_acc_no !== old_acc_no) {
        await conn.query("UPDATE transactions SET acc_no=? WHERE acc_no=?", [new_acc_no, old_acc_no]);
        await conn.query("UPDATE lockers SET acc_no=? WHERE acc_no=?", [new_acc_no, old_acc_no]);
        await conn.query("UPDATE requests SET acc_no=? WHERE acc_no=?", [new_acc_no, old_acc_no]);
      }

      await conn.query("UPDATE requests SET status='APPROVED' WHERE id=?", [id]);

      await conn.commit();
      return res.json({ msg: "Update request approved" });
    }

    // Unknown type
    await conn.query("UPDATE requests SET status='REJECTED' WHERE id=?", [id]);
    await conn.commit();
    return res.status(400).json({ msg: "Unknown request type" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ msg: "Server error", err: err.message });
  } finally {
    conn.release();
  }
});

/* ---------------- WIPE ---------------- */

app.delete("/api/wipe", async (req, res) => {
  try {
    await db.query("DELETE FROM transactions");
    await db.query("DELETE FROM requests");
    await db.query("DELETE FROM lockers");
    await db.query("DELETE FROM accounts");
    res.json({ msg: "All data wiped" });
  } catch (err) {
    res.status(500).json({ msg: "Server error", err: err.message });
  }
});

/* ---------------- START ---------------- */

app.listen(PORT, () => console.log(`Backend running on http://127.0.0.1:${PORT}`));
