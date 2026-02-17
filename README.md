# FinVault Banks 🏦  
A Full-Stack Banking Management System (Admin + User Portal)

## 📌 Overview
FinVault Banks is a web-based banking management system built using **Node.js (Express)** and **MySQL**, with a clean **HTML/CSS/JavaScript** frontend.  
It supports core banking operations like **account creation, deposits, withdrawals, locker management, and transaction history**, along with an **admin approval workflow**.

---

## ✨ Features

### 👤 User Portal
- Submit **Account Opening Request**
- Submit **Account Update Request** (Name + Account No)
- Submit **Locker Request**
- Access Locker using **Locker Key**
- View **Account Details**
- View **Transaction History**

### 🛡️ Admin Panel
- Deposit / Withdraw money
- Full Update (Account No + Name)
- Delete Account
- View all Accounts + Locker status
- View last 20 transactions per account
- Wipe all database data (for testing)

### 📥 Requests Panel
- View all requests in one place
- Approve / Reject:
  - CREATE_ACCOUNT
  - UPDATE_ACCOUNT
  - CREATE_LOCKER
- Status tracking: **PENDING / APPROVED / REJECTED**
- Auto refresh support (notification-like experience)

---

## 🧠 Tech Stack
- **Frontend:** HTML, CSS, JavaScript  
- **Backend:** Node.js, Express.js  
- **Database:** MySQL  
- **Other:** CORS, MySQL2 (Promise)

---


