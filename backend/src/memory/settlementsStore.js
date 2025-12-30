// backend/src/memory/settlementsStore.js

// ================== 自增 ID & 内存数据 ==================
let leaderSeq = 1;
let driverSeq = 1;
let withdrawalseq = 1;
const withdrawals =[]; // 提现记录
const leaderSettlements = []; // 团长结算记录
const driverSettlements = []; // 司机结算记录

// ================== 通用工具函数 ==================
function toNumber(val, def) {
  const n = Number(val);
  return Number.isNaN(n) ? def : n;
}

function inDateRange(date, startDate, endDate) {
  if (!startDate && !endDate) return true;
  const t = date.getTime();
  if (startDate && t < startDate.getTime()) return false;
  if (endDate && t > endDate.getTime()) return false;
  return true;
}

function paginate(list, page, pageSize) {
  const p = toNumber(page, 1);
  const ps = toNumber(pageSize, 10);
  const total = list.length;
  const start = (p - 1) * ps;
  const end = start + ps;
  return {
    page: p,
    pageSize: ps,
    total,
    list: list.slice(start, end),
  };
}

function isSameMonth(d, year, monthIndex) {
  return d.getFullYear() === year && d.getMonth() === monthIndex; // 0-11
}

// ================== 团长结算（底层实现） ==================

// 真正往内存里塞一条记录的函数
export function createLeaderSettlement(payload = {}) {
  const now = new Date();
  const {
    leaderName = "未命名团长",
    leaderPhone = "",
    periodStart = now,
    periodEnd = now,
    orderCount = 0,
    amount = 0, // 应结金额
    status = "pending", // pending / settled
    remark = "",
  } = payload;

  const record = {
    id: leaderSeq++,
    leaderName,
    leaderPhone,
    periodStart: new Date(periodStart),
    periodEnd: new Date(periodEnd),
    orderCount: Number(orderCount),
    amount: Number(amount),
    status,
    remark,
    createdAt: now,
    updatedAt: now,
  };

  leaderSettlements.push(record);
  return record;
}

export function listLeaderSettlements(options = {}) {
  const {
    leaderName,
    status,
    startDate,
    endDate,
    page = 1,
    pageSize = 10,
  } = options;

  let list = leaderSettlements.slice().sort((a, b) => b.createdAt - a.createdAt);

  if (leaderName) {
    const kw = leaderName.trim().toLowerCase();
    list = list.filter(
      (r) =>
        r.leaderName.toLowerCase().includes(kw) ||
        (r.leaderPhone && r.leaderPhone.includes(kw))
    );
  }

  let sd = null;
  let ed = null;
  if (startDate) sd = new Date(startDate);
  if (endDate) {
    const tmp = new Date(endDate);
    tmp.setHours(23, 59, 59, 999);
    ed = tmp;
  }
  if (sd || ed) {
    list = list.filter((r) => inDateRange(r.createdAt, sd, ed));
  }

  if (status) {
    list = list.filter((r) => r.status === status);
  }

  const pageData = paginate(list, page, pageSize);

  // 汇总：待结算金额、本月已结算金额
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();

  let pendingAmount = 0;
  let settledThisMonth = 0;

  leaderSettlements.forEach((r) => {
    if (r.status === "pending") {
      pendingAmount += r.amount;
    }
    if (r.status === "settled" && isSameMonth(r.createdAt, year, monthIndex)) {
      settledThisMonth += r.amount;
    }
  });

  return {
    ...pageData,
    summary: {
      pendingAmount,
      settledThisMonth,
    },
  };
}

export function updateLeaderSettlementStatus(id, status, remark) {
  const numericId = toNumber(id, null);
  if (numericId == null) return null;

  const r = leaderSettlements.find((item) => item.id === numericId);
  if (!r) return null;

  if (status) r.status = status;
  if (typeof remark === "string") r.remark = remark;
  r.updatedAt = new Date();
  return r;
}

export function markAllLeaderSettlementsPaid() {
  let count = 0;
  leaderSettlements.forEach((r) => {
    if (r.status === "pending") {
      r.status = "settled";
      r.updatedAt = new Date();
      count++;
    }
  });
  return count;
}

// ================== 司机结算 ==================
export function createDriverSettlement(payload = {}) {
  const now = new Date();
  const {
    driverName = "未命名司机",
    driverPhone = "",
    date = now,
    orderCount = 0,
    amount = 0,
    status = "pending",
    remark = "",
  } = payload;

  const record = {
    id: driverSeq++,
    driverName,
    driverPhone,
    date: new Date(date),
    orderCount: Number(orderCount),
    amount: Number(amount),
    status,
    remark,
    createdAt: now,
    updatedAt: now,
  };

  driverSettlements.push(record);
  return record;
}

export function listDriverSettlements(options = {}) {
  const {
    driverName,
    status,
    startDate,
    endDate,
    page = 1,
    pageSize = 10,
  } = options;

  let list = driverSettlements.slice().sort((a, b) => b.createdAt - a.createdAt);

  if (driverName) {
    const kw = driverName.trim().toLowerCase();
    list = list.filter(
      (r) =>
        r.driverName.toLowerCase().includes(kw) ||
        (r.driverPhone && r.driverPhone.includes(kw))
    );
  }

  let sd = null;
  let ed = null;
  if (startDate) sd = new Date(startDate);
  if (endDate) {
    const tmp = new Date(endDate);
    tmp.setHours(23, 59, 59, 999);
    ed = tmp;
  }
  if (sd || ed) {
    list = list.filter((r) => inDateRange(r.createdAt, sd, ed));
  }

  if (status) {
    list = list.filter((r) => r.status === status);
  }

  const pageData = paginate(list, page, pageSize);

  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();

  let pendingAmount = 0;
  let settledThisMonth = 0;

  driverSettlements.forEach((r) => {
    if (r.status === "pending") {
      pendingAmount += r.amount;
    }
    if (r.status === "settled" && isSameMonth(r.createdAt, year, monthIndex)) {
      settledThisMonth += r.amount;
    }
  });

  return {
    ...pageData,
    summary: {
      pendingAmount,
      settledThisMonth,
    },
  };
}

export function updateDriverSettlementStatus(id, status, remark) {
  const numericId = toNumber(id, null);
  if (numericId == null) return null;

  const r = driverSettlements.find((item) => item.id === numericId);
  if (!r) return null;

  if (status) r.status = status;
  if (typeof remark === "string") r.remark = remark;
  r.updatedAt = new Date();
  return r;
}
// ================== 提现记录（内存版） ==================

export function createWithdrawal(payload = {}) {
  const now = new Date();
  const {
    leaderId = "",
    leaderName = "未命名团长",
    leaderPhone = "",
    amount,
    method = "bank",
    accountInfo = "",
    status = "pending", // pending / approved / rejected / paid
    adminRemark = "",
    rejectedReason = "",
    handledBy = "",
    handledAt = null,
  } = payload;

  if (amount == null) {
    throw new Error("amount 必填");
  }

  const record = {
    id: withdrawalSeq++,
    leaderId,
    leaderName,
    leaderPhone,
    amount: Number(amount),
    method,
    accountInfo,
    status,
    adminRemark,
    rejectedReason,
    handledBy,
    handledAt,
    createdAt: now,
    updatedAt: now,
  };

  withdrawals.push(record);
  return record;
}

export function listWithdrawals(options = {}) {
  const {
    leaderName,
    status,
    startDate,
    endDate,
    page = 1,
    pageSize = 10,
  } = options;

  let list = withdrawals.slice().sort((a, b) => b.createdAt - a.createdAt);

  if (leaderName) {
    const kw = leaderName.trim().toLowerCase();
    list = list.filter(
      (w) =>
        w.leaderName.toLowerCase().includes(kw) ||
        (w.leaderPhone && w.leaderPhone.includes(kw))
    );
  }

  let sd = null;
  let ed = null;
  if (startDate) sd = new Date(startDate);
  if (endDate) {
    const tmp = new Date(endDate);
    tmp.setHours(23, 59, 59, 999);
    ed = tmp;
  }
  if (sd || ed) {
    list = list.filter((w) => inDateRange(w.createdAt, sd, ed));
  }

  if (status) {
    list = list.filter((w) => w.status === status);
  }

  const pageData = paginate(list, page, pageSize);
  return pageData; // { list, total, page, pageSize }
}

export function updateWithdrawalStatus(id, payload = {}) {
  const numericId = toNumber(id, null);
  if (numericId == null) return null;

  const w = withdrawals.find((item) => item.id === numericId);
  if (!w) return null;

  const { status, adminRemark, rejectedReason, handledBy } = payload;

  if (status) w.status = status;
  if (typeof adminRemark === "string") w.adminRemark = adminRemark;
  if (typeof rejectedReason === "string") w.rejectedReason = rejectedReason;
  if (typeof handledBy === "string") w.handledBy = handledBy;

  w.handledAt = new Date();
  w.updatedAt = new Date();
  return w;
}
// ================== 兼容你之前的 admin_settlements_memory.js ==================

// 之前你引用的是 createSettlement / listSettlements / updateSettlementStatus
// 这里直接把它们当“团长结算”的别名，避免再去改别的文件

export function createSettlement(payload = {}) {
  return createLeaderSettlement(payload);
}

export function listSettlements(options = {}) {
  const { list, total, page, pageSize } = listLeaderSettlements(options);
  // 兼容老结构：不返回 summary，只返回分页数据
  return { list, total, page, pageSize };
}

export function updateSettlementStatus(id, status, remark) {
  return updateLeaderSettlementStatus(id, status, remark);
}

// 调试用
export function _debugGetAll() {
  return { leaderSettlements, driverSettlements };
}
