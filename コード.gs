const SS_ID = '1Uv2f1WoUyWwfhDLVp-Xwg6V9zlgTTBzPVZuh5mU5fy0';

const SYSTEM_SETTINGS = { defaultApprovalMode: 'daily' };

function ss() { return SpreadsheetApp.openById(SS_ID); }

function toYMD(v) {
  if (!v) return '';
  const d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function toYM(v) { return toYMD(v).slice(0, 7); }

// ============================================================
// シート読み込みを1回にまとめるキャッシュ関数
// 3関数がバラバラにシートを開いていた無駄を排除
// ============================================================
function loadAllSheets() {
  const s = ss();
  const sheetNames = ['荷主マスタ', '委託先マスタ', '案件マスタ', '勤務記録', 'project_payees'];
  const result = {};

  sheetNames.forEach(name => {
    const sheet = s.getSheetByName(name);
    if (!sheet || sheet.getLastRow() <= 1) {
      result[name] = [];
      return;
    }
    // getDisplayValues()で日付型エラーを防止
    const data = sheet.getDataRange().getDisplayValues();
    const headers = data[0];
    result[name] = data.slice(1).map((row, idx) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      obj._rowIndex = idx + 2; // 1-based sheet row (row 1 = headers)
      return obj;
    });
  });

  return result;
}

function getDeductionRate(d) {
  if (d <= new Date('2026-09-30')) return 0.02;
  if (d <= new Date('2029-09-30')) return 0.05;
  return 0.10;
}

function calcTax(netTotal) { return Math.round(netTotal * 0.10); }
function calcDeduction(netTotal, rate) { return Math.floor(netTotal * rate); }

// ============================================================
// 全データをまとめて取得（シート読み込みは1回だけ）
// ============================================================
function getAllData(month) {
  try {
    const sheets = loadAllSheets();
    const clis   = sheets['荷主マスタ'];
    const cons   = sheets['委託先マスタ'];
    const projs  = sheets['案件マスタ'];
    const works  = sheets['勤務記録'];

    const testModes = ['daily', 'monthly', 'off'];
    const consWithMode = cons.map((co, i) =>
      Object.assign({}, co, { approvalMode: testModes[i % 3] })
    );

    const monthWorks = works.filter(w => toYM(w['勤務日']) === month);

    const ppSheet = sheets['project_payees'] || [];
    return {
      sales:          buildSalesData(monthWorks, projs, clis, consWithMode),
      payment:        buildPaymentPreview(monthWorks, consWithMode, projs, ppSheet),
      invoice:        buildInvoiceData(monthWorks, clis, projs),
      systemSettings: SYSTEM_SETTINGS,
      contractors:    consWithMode.map(co => ({
        id:           co['委託先ID'],
        name:         co['氏名'],
        approvalMode: co['approvalMode'],
        invoiceStatus: co['インボイス区分'],
      })),
      projects:       projs.map(p => ({ id: p['案件ID'], name: p['案件名'] })),
      projectPayees:  ppSheet,
      clients:        clis.map(cl => ({ id: cl['荷主ID'], name: cl['会社名'] })),
    };
  } catch (e) {
    throw new Error('データ取得エラー: ' + e.message);
  }
}

// ============================================================
// 売上データ構築（シートオブジェクトを引数で受け取る）
// ============================================================
function buildSalesData(monthWorks, projs, clis, cons) {
  const rows = monthWorks.map(w => {
    const pr    = projs.find(p => p['案件ID'] === w['案件ID']) || {};
    const cl    = clis.find(c => c['荷主ID'] === pr['荷主ID']) || {};
    const co    = cons.find(c => c['委託先ID'] === w['委託先ID']) || {};
    const sales = Number(w['税抜き売上']) || 0;
    const pay   = Number(w['税抜き支払']) || 0;
    return {
      rowIndex:           w._rowIndex,
      date:               toYMD(w['勤務日']),
      clientName:         cl['会社名'] || '',
      projectName:        pr['案件名'] || '',
      contractorName:     co['氏名'] || '',
      invoiceStatus:      co['インボイス区分'] || '未登録',
      unitType:           pr['単価方式'] || '',
      quantity:           Number(w['個数']) || 0,
      taxExcludedSales:   sales,
      taxExcludedPayment: pay,
      grossProfit:        sales - pay,
      approvalStatus:     w['承認ステータス'] || '未承認',
      approvalMode:       co['approvalMode'] || SYSTEM_SETTINGS.defaultApprovalMode,
    };
  });

  const summary = {};
  rows.forEach(r => {
    if (!summary[r.clientName]) {
      summary[r.clientName] = { totalSales: 0, totalPayment: 0, totalProfit: 0 };
    }
    summary[r.clientName].totalSales   += r.taxExcludedSales;
    summary[r.clientName].totalPayment += r.taxExcludedPayment;
    summary[r.clientName].totalProfit  += r.grossProfit;
  });

  return { records: rows, summary };
}

// ============================================================
// 支払通知書構築
// ============================================================
function buildPaymentPreview(monthWorks, cons, projs, projectPayees) {
  const today = new Date();
  const dr    = getDeductionRate(today);

  // project_payeesからprojId→payee_contractor_idのマップ構築
  const payeeMap = {};
  (projectPayees || []).forEach(pp => {
    if (pp['案件ID']) payeeMap[pp['案件ID']] = pp['payee_contractor_id'] || null;
  });

  // 勤務記録をpayee_contractor_idでグループ化（未設定時は委託先IDにフォールバック）
  const payeeGroups = {};
  monthWorks.forEach(w => {
    const payeeId = payeeMap[w['案件ID']] || w['委託先ID'];
    if (!payeeGroups[payeeId]) payeeGroups[payeeId] = [];
    payeeGroups[payeeId].push(w);
  });

  return Object.entries(payeeGroups).map(([payeeId, rows]) => {
    const co = cons.find(c => c['委託先ID'] === payeeId) || {};

    const details = rows.map(w => {
      const pr = projs.find(p => p['案件ID'] === w['案件ID']) || {};
      return {
        date:        toYMD(w['勤務日']),
        projectName: pr['案件名'] || '',
        quantity:    Number(w['個数']) || 0,
        amount:      Number(w['税抜き支払']) || 0,
      };
    });

    const netTotal = details.reduce((s, d) => s + d.amount, 0);
    const tax      = calcTax(netTotal);
    const isReg    = co['インボイス区分'] === '登録あり';
    const ded      = isReg ? 0 : calcDeduction(netTotal, dr);

    return {
      name:          co['氏名'] || payeeId,
      invoiceStatus: co['インボイス区分'] || '未登録',
      sum: netTotal, tax,
      deductionRate: dr,
      deduction:     ded,
      total:         netTotal + tax - ded,
      isReg,
      details,
    };
  }).filter(x => x.sum > 0);
}

// ============================================================
// 請求書データ構築
// ============================================================
function buildInvoiceData(monthWorks, clis, projs) {
  return clis.map(cl => {
    const myProjIds = projs
      .filter(p => p['荷主ID'] === cl['荷主ID'])
      .map(p => p['案件ID']);

    const rows = monthWorks.filter(w => myProjIds.includes(w['案件ID']));
    if (!rows.length) return null;

    const totalExcl = rows.reduce((s, w) => s + (Number(w['税抜き売上']) || 0), 0);
    const tax       = calcTax(totalExcl);

    // 入金期限計算：getDisplayValues()で文字列化されているので直接扱う
    const [ym]  = monthWorks[0] ? [monthWorks[0]['勤務日'].slice(0, 7)] : [null];
    const [y, m] = ym ? ym.split('-').map(Number) : [0, 0];
    const due    = cl['締め日'] === '月末'
      ? new Date(y, m + 1, 0)
      : new Date(y, m, 0);

    return {
      clientName: cl['会社名'],
      totalExcl,
      tax,
      total:   totalExcl + tax,
      dueDate: toYMD(due),
      details: rows.map(w => {
        const pr = projs.find(p => p['案件ID'] === w['案件ID']) || {};
        return {
          date:        toYMD(w['勤務日']),
          projectName: pr['案件名'] || '',
          quantity:    Number(w['個数']) || 0,
          amount:      Number(w['税抜き売上']) || 0,
        };
      }),
    };
  }).filter(Boolean);
}

// ============================================================
// doGet：HTMLだけ即返す。データはJS側が非同期で取りに来る
// ここでスプレッドシートを触らないのがポイント
// ============================================================
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('運送業務管理システム')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ============================================================
// 承認履歴ログ（approval_historyシートへ記録・appendRowのみ・上書き不可）
// ============================================================
function saveApprovalHistory(targetType, targetId, actionType, operatorId, beforeAmount, afterAmount, memo) {
  var s = ss();
  var sheet = s.getSheetByName('approval_history');
  if (!sheet) {
    sheet = s.insertSheet('approval_history');
    sheet.appendRow(['記録日時', '対象種別', '対象ID', 'アクション', '操作者ID', '変更前金額', '変更後金額', 'メモ']);
    try {
      var prot = sheet.protect().setDescription('承認履歴ログ（変更不可）');
      prot.removeEditors(prot.getEditors());
    } catch(e) {}
  }
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var memoIdx = headers.indexOf('メモ');
  if (memoIdx < 0) {
    sheet.getRange(1, headers.length + 1).setValue('メモ');
    memoIdx = headers.length;
  }
  var row = [
    new Date(),
    targetType,
    targetId,
    actionType,
    operatorId,
    beforeAmount != null ? beforeAmount : '',
    afterAmount  != null ? afterAmount  : '',
  ];
  while (row.length <= memoIdx) row.push('');
  row[memoIdx] = memo != null ? memo : '';
  sheet.appendRow(row);
  return { ok: true };
}

// ============================================================
// 承認ステータス切り替え＋スナップショット保護
// ============================================================
function toggleApprovalStatus(targetType, targetId, month, currentStatus, operatorId) {
  var s = ss();

  // targetId is contractor name; resolve to 委託先ID via 委託先マスタ
  var contractorId = null;
  var conSheet = s.getSheetByName('委託先マスタ');
  if (conSheet && conSheet.getLastRow() > 1) {
    var conData    = conSheet.getDataRange().getValues();
    var conHeaders = conData[0];
    var nameCol    = conHeaders.indexOf('氏名');
    var conIdCol   = conHeaders.indexOf('委託先ID');
    if (nameCol >= 0 && conIdCol >= 0) {
      for (var j = 1; j < conData.length; j++) {
        if (String(conData[j][nameCol]) === String(targetId)) {
          contractorId = String(conData[j][conIdCol]);
          break;
        }
      }
    }
  }
  if (!contractorId) throw new Error('委託先が見つかりません: ' + targetId);

  var sheet = s.getSheetByName('勤務記録');
  if (!sheet) throw new Error('勤務記録シートが見つかりません');

  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var idCol   = headers.indexOf('委託先ID');
  var stCol   = headers.indexOf('承認ステータス');
  var dateCol = headers.indexOf('勤務日');
  if (idCol < 0 || stCol < 0 || dateCol < 0) throw new Error('必要な列が見つかりません');

  var mp = month.split('-');
  var tY = parseInt(mp[0], 10);
  var tM = parseInt(mp[1], 10);

  var newStatus  = (currentStatus === '承認済') ? '未承認' : '承認済';
  var actionType = (currentStatus === '承認済') ? '取り消し' : '承認';
  var locked     = false;
  var updated    = 0;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) !== contractorId) continue;

    var rd = data[i][dateCol];
    var d  = (rd instanceof Date) ? rd : new Date(rd);
    if (isNaN(d.getTime()) || d.getFullYear() !== tY || (d.getMonth() + 1) !== tM) continue;

    if (currentStatus === '承認済') {
      locked = true;
    }
    sheet.getRange(i + 1, stCol + 1).setValue(newStatus);
    updated++;
  }

  SpreadsheetApp.flush();
  saveApprovalHistory(targetType, targetId, actionType, operatorId, null, null);

  return { ok: true, newStatus: newStatus, updated: updated, locked: locked };
}

// ============================================================
// 日次承認ステータス切り替え（rowIndexで特定した1行のみ更新）
// ============================================================
function toggleDailyApprovalStatus(rowIndex, contractorName, date, currentStatus, operatorId) {
  var s     = ss();
  var sheet = s.getSheetByName('勤務記録');
  if (!sheet) throw new Error('勤務記録シートが見つかりません');

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var stCol   = headers.indexOf('承認ステータス');
  if (stCol < 0) throw new Error('承認ステータス列が見つかりません');

  var newStatus  = (currentStatus === '承認済') ? '未承認' : '承認済';
  var actionType = (currentStatus === '承認済') ? '取り消し' : '承認';

  sheet.getRange(rowIndex, stCol + 1).setValue(newStatus);
  SpreadsheetApp.flush();
  saveApprovalHistory('勤務記録_日次', contractorName + '_' + date, actionType, operatorId, null, null);

  return { ok: true, newStatus: newStatus, updated: 1 };
}

// ============================================================
// 承認履歴取得（フロントエンドへ返す）
// ============================================================
function getApprovalHistory() {
  var s     = ss();
  var sheet = s.getSheetByName('approval_history');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  return data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    if (obj['記録日時'] instanceof Date) {
      obj['記録日時'] = Utilities.formatDate(obj['記録日時'], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    }
    return obj;
  });
}

// ============================================================
// 案件支払先設定の保存（project_payeesシートへupsert）
// ============================================================
function saveProjectPayee(projId, viaContractorId, payeeContractorId) {
  if (!projId || !payeeContractorId) throw new Error('案件IDおよびpayee_contractor_idは必須です');

  const s = ss();
  let sheet = s.getSheetByName('project_payees');
  if (!sheet) {
    sheet = s.insertSheet('project_payees');
    sheet.appendRow(['案件ID', 'via_contractor_id', 'payee_contractor_id']);
  }

  const data    = sheet.getDataRange().getValues();
  const headers = data[0];
  const projCol = headers.indexOf('案件ID');
  const viaCol  = headers.indexOf('via_contractor_id');
  const payCol  = headers.indexOf('payee_contractor_id');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][projCol]) === String(projId)) {
      sheet.getRange(i + 1, viaCol + 1).setValue(viaContractorId || '');
      sheet.getRange(i + 1, payCol + 1).setValue(payeeContractorId);
      SpreadsheetApp.flush();
      return { ok: true, action: 'updated' };
    }
  }

  sheet.appendRow([projId, viaContractorId || '', payeeContractorId]);
  SpreadsheetApp.flush();
  return { ok: true, action: 'created' };
}

// ============================================================
// 案件支払先設定の一覧取得
// ============================================================
function getProjectPayees() {
  const s     = ss();
  const sheet = s.getSheetByName('project_payees');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const data    = sheet.getDataRange().getDisplayValues();
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ============================================================
// ロック状態確認
// ============================================================
function checkLockStatus(targetType, targetId) {
  var s     = ss();
  var sheet = s.getSheetByName('lock_registry');
  if (!sheet || sheet.getLastRow() <= 1) return { isLocked: false };
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  var typeCol   = headers.indexOf('targetType');
  var idCol     = headers.indexOf('targetId');
  var lockedCol = headers.indexOf('isLocked');
  if (typeCol < 0 || idCol < 0 || lockedCol < 0) return { isLocked: false };
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][typeCol]) === String(targetType) &&
        String(data[i][idCol])   === String(targetId)) {
      return { isLocked: Boolean(data[i][lockedCol]) };
    }
  }
  return { isLocked: false };
}

// ============================================================
// 子分承認（承認済ステータス設定＋確定ロックフラグ立て）
// ============================================================
function approvePaymentNotice(noticeId, month) {
  if (!noticeId) throw new Error('noticeIdは必須です');
  var lockStatus = checkLockStatus('支払通知書', noticeId);
  if (lockStatus.isLocked) throw new Error('既にロック済みです: ' + noticeId);

  var s = ss();

  // 対象月の勤務記録を承認済に更新
  if (month) {
    var wSheet = s.getSheetByName('勤務記録');
    if (!wSheet) throw new Error('勤務記録シートが見つかりません');
    var wData    = wSheet.getDataRange().getValues();
    var wHeaders = wData[0];
    var widCol   = wHeaders.indexOf('委託先ID');
    var wstCol   = wHeaders.indexOf('承認ステータス');
    var wdateCol = wHeaders.indexOf('勤務日');

    // noticeId（委託先名）→委託先IDに変換
    var contractorId = null;
    var conSheet = s.getSheetByName('委託先マスタ');
    if (conSheet && conSheet.getLastRow() > 1) {
      var conData    = conSheet.getDataRange().getValues();
      var conHeaders = conData[0];
      var nameCol    = conHeaders.indexOf('氏名');
      var conIdCol   = conHeaders.indexOf('委託先ID');
      for (var j = 1; j < conData.length; j++) {
        if (String(conData[j][nameCol]) === String(noticeId)) {
          contractorId = String(conData[j][conIdCol]);
          break;
        }
      }
    }
    if (contractorId && widCol >= 0 && wstCol >= 0 && wdateCol >= 0) {
      var mp = month.split('-');
      var tY = parseInt(mp[0], 10), tM = parseInt(mp[1], 10);
      for (var wi = 1; wi < wData.length; wi++) {
        if (String(wData[wi][widCol]) !== contractorId) continue;
        var rd = wData[wi][wdateCol];
        var d  = (rd instanceof Date) ? rd : new Date(rd);
        if (isNaN(d.getTime()) || d.getFullYear() !== tY || (d.getMonth() + 1) !== tM) continue;
        wSheet.getRange(wi + 1, wstCol + 1).setValue('承認済');
      }
    }
  }

  // lock_registryに確定ロックを記録
  var lrSheet = s.getSheetByName('lock_registry');
  if (!lrSheet) {
    lrSheet = s.insertSheet('lock_registry');
    lrSheet.appendRow(['targetType', 'targetId', 'isLocked', 'lockedAt', 'lockedBy']);
    try { lrSheet.protect().setDescription('ロック管理台帳（変更不可）'); } catch(e) {}
  }
  var lrData    = lrSheet.getDataRange().getValues();
  var lrHeaders = lrData[0];
  var ltCol  = lrHeaders.indexOf('targetType');
  var liCol  = lrHeaders.indexOf('targetId');
  var llCol  = lrHeaders.indexOf('isLocked');
  var laCol  = lrHeaders.indexOf('lockedAt');
  var found  = false;
  for (var k = 1; k < lrData.length; k++) {
    if (String(lrData[k][ltCol]) === '支払通知書' && String(lrData[k][liCol]) === String(noticeId)) {
      lrSheet.getRange(k + 1, llCol + 1).setValue(true);
      lrSheet.getRange(k + 1, laCol + 1).setValue(new Date());
      found = true;
      break;
    }
  }
  if (!found) {
    lrSheet.appendRow(['支払通知書', noticeId, true, new Date(), 'system']);
  }

  SpreadsheetApp.flush();
  saveApprovalHistory('支払通知書', noticeId, '確定ロック', 'system', null, null, null);
  return { ok: true, noticeId: noticeId, locked: true };
}

// ============================================================
// 翌月調整枠の生成（ロック後修正用・next_month_adjustmentsシートへ追記）
// ============================================================
function applyNextMonthAdjustment(contractorId, amount, reason) {
  if (!contractorId || amount == null || !reason) {
    throw new Error('contractorId, amount, reasonは必須です');
  }
  var s     = ss();
  var sheet = s.getSheetByName('next_month_adjustments');
  if (!sheet) {
    sheet = s.insertSheet('next_month_adjustments');
    sheet.appendRow(['作成日時', '委託先ID', '調整金額', '理由', '対象月', '適用ステータス']);
  }
  var now           = new Date();
  var nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  var targetMonth   = nextMonthDate.getFullYear() + '-' +
    String(nextMonthDate.getMonth() + 1).padStart(2, '0');

  sheet.appendRow([now, contractorId, Number(amount), reason, targetMonth, '未適用']);
  SpreadsheetApp.flush();
  return { ok: true, contractorId: contractorId, amount: Number(amount), targetMonth: targetMonth };
}

// ============================================================
// 開発者アンロック（理由ログをapproval_historyに先行書き込み→解除）
// ============================================================
function developerUnlock(targetType, targetId, unlockReason) {
  if (!unlockReason || String(unlockReason).trim() === '') {
    throw new Error('アンロック理由は必須です');
  }
  var lockStatus = checkLockStatus(targetType, targetId);
  if (!lockStatus.isLocked) {
    throw new Error('ロック状態ではありません: ' + targetId);
  }

  // 理由ログをapproval_historyへ強制書き込み（ロック解除より必ず先に実行）
  saveApprovalHistory(targetType, targetId, '開発者アンロック', 'developer', null, null, unlockReason);
  SpreadsheetApp.flush();

  // approval_historyシートの保護を確認・適用
  var s       = ss();
  var ahSheet = s.getSheetByName('approval_history');
  if (ahSheet) {
    try {
      var prots = ahSheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
      if (!prots || prots.length === 0) {
        var p = ahSheet.protect().setDescription('承認履歴ログ（変更不可）');
        p.removeEditors(p.getEditors());
      }
    } catch(e) {}
  }

  // lock_registryのロックを解除
  var lrSheet = s.getSheetByName('lock_registry');
  if (lrSheet && lrSheet.getLastRow() > 1) {
    var data    = lrSheet.getDataRange().getValues();
    var headers = data[0];
    var typeCol   = headers.indexOf('targetType');
    var idCol     = headers.indexOf('targetId');
    var lockedCol = headers.indexOf('isLocked');
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][typeCol]) === String(targetType) &&
          String(data[i][idCol])   === String(targetId)) {
        lrSheet.getRange(i + 1, lockedCol + 1).setValue(false);
        break;
      }
    }
  }

  SpreadsheetApp.flush();
  return { ok: true, targetType: targetType, targetId: targetId, unlocked: true };
}

// ============================================================
// 立替金・経費記録の取得（対象月）
// ============================================================
function getExpenseRecords(month) {
  var s     = ss();
  var sheet = s.getSheetByName('expense_records');
  if (!sheet || sheet.getLastRow() <= 1) return [];
  var data    = sheet.getDataRange().getValues();
  var headers = data[0];
  return data.slice(1).map(function(row, idx) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    if (obj['記録日時'] instanceof Date) {
      obj['記録日時'] = Utilities.formatDate(obj['記録日時'], Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    }
    var dv = obj['日付'];
    obj['日付'] = (dv instanceof Date)
      ? Utilities.formatDate(dv, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : String(dv).slice(0, 10);
    obj._rowIndex = idx + 2;
    return obj;
  }).filter(function(r) {
    return String(r['日付']).slice(0, 7) === month;
  });
}

// ============================================================
// 立替金モック入力（子分のスマホ入力をシミュレート）
// ============================================================
function addExpenseRecordMock(contractorId, date, type, amount, remarks) {
  if (!contractorId || !date || !type || amount == null) {
    throw new Error('委託先ID、日付、種別、金額は必須です');
  }
  var s     = ss();
  var sheet = s.getSheetByName('expense_records');
  if (!sheet) {
    sheet = s.insertSheet('expense_records');
    sheet.appendRow(['記録日時', '委託先ID', '日付', '種別', '金額', '備考', 'ステータス']);
  }
  sheet.appendRow([new Date(), contractorId, date, type, Number(amount), remarks || '', '未承認']);
  SpreadsheetApp.flush();
  return { ok: true };
}

// ============================================================
// 立替金承認（rowIndexで特定した1行をステータス→「承認済」）
// ============================================================
function approveExpenseRecord(rowIndex) {
  var s     = ss();
  var sheet = s.getSheetByName('expense_records');
  if (!sheet) throw new Error('expense_recordsシートが見つかりません');
  var headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var statusCol = headers.indexOf('ステータス');
  if (statusCol < 0) throw new Error('ステータス列が見つかりません');
  sheet.getRange(rowIndex, statusCol + 1).setValue('承認済');
  SpreadsheetApp.flush();
  return { ok: true, rowIndex: rowIndex };
}

// ============================================================
// 支払通知書プレビュー（承認済み立替金を報酬と別行計上）
// ============================================================
function getPaymentWithExpenses(month) {
  var sheetData    = loadAllSheets();
  var cons         = sheetData['委託先マスタ'];
  var projs        = sheetData['案件マスタ'];
  var works        = sheetData['勤務記録'];
  var ppData       = sheetData['project_payees'] || [];
  var testModes    = ['daily', 'monthly', 'off'];
  var consWithMode = cons.map(function(co, i) {
    return Object.assign({}, co, { approvalMode: testModes[i % 3] });
  });
  var monthWorks = works.filter(function(w) { return toYM(w['勤務日']) === month; });

  var payeeMap = {};
  ppData.forEach(function(pp) {
    if (pp['案件ID']) payeeMap[pp['案件ID']] = pp['payee_contractor_id'] || null;
  });

  var payeeGroups = {};
  monthWorks.forEach(function(w) {
    var pid = payeeMap[w['案件ID']] || w['委託先ID'];
    if (!payeeGroups[pid]) payeeGroups[pid] = [];
    payeeGroups[pid].push(w);
  });

  // 承認済み立替金をcontractorIdごとにグループ化
  var expRecs = getExpenseRecords(month).filter(function(r) {
    return r['ステータス'] === '承認済';
  });
  var expMap = {};
  expRecs.forEach(function(r) {
    var cid = String(r['委託先ID']);
    if (!expMap[cid]) expMap[cid] = [];
    expMap[cid].push({
      date:    r['日付'],
      type:    r['種別'],
      amount:  Number(r['金額']) || 0,
      remarks: r['備考'] || '',
    });
  });

  var today = new Date();
  var dr    = getDeductionRate(today);

  return Object.entries(payeeGroups).map(function(entry) {
    var payeeId = entry[0], rows = entry[1];
    var co = consWithMode.find(function(c) { return c['委託先ID'] === payeeId; }) || {};

    var details = rows.map(function(w) {
      var pr = projs.find(function(p) { return p['案件ID'] === w['案件ID']; }) || {};
      return {
        date:        toYMD(w['勤務日']),
        projectName: pr['案件名'] || '',
        quantity:    Number(w['個数']) || 0,
        amount:      Number(w['税抜き支払']) || 0,
      };
    });

    var netTotal   = details.reduce(function(s, d) { return s + d.amount; }, 0);
    var tax        = calcTax(netTotal);
    var isReg      = co['インボイス区分'] === '登録あり';
    var ded        = isReg ? 0 : calcDeduction(netTotal, dr);
    var laborTotal = netTotal + tax - ded;

    var expenses     = expMap[payeeId] || [];
    var expenseTotal = expenses.reduce(function(s, e) { return s + e.amount; }, 0);
    var expenseTax   = Math.round(expenseTotal * 0.10);

    return {
      contractorId:  payeeId,
      name:          co['氏名'] || payeeId,
      invoiceStatus: co['インボイス区分'] || '未登録',
      sum:           netTotal,
      tax:           tax,
      deductionRate: dr,
      deduction:     ded,
      isReg:         isReg,
      laborTotal:    laborTotal,
      details:       details,
      expenses:      expenses,
      expenseTotal:  expenseTotal,
      expenseTax:    expenseTax,
      grandTotal:    laborTotal + expenseTotal + expenseTax,
    };
  }).filter(function(x) { return x.sum > 0 || x.expenseTotal > 0; });
}

// ============================================================
// 未登録スポット案件の検知（勤務記録を走査し重複なく返す）
// ============================================================
function getUnregisteredSpots() {
  var s = ss();
  var wSheet = s.getSheetByName('勤務記録');
  if (!wSheet || wSheet.getLastRow() <= 1) return [];

  // 正式マスタの案件IDセットを構築
  var masterIds = {};
  var projSheet = s.getSheetByName('案件マスタ');
  if (projSheet && projSheet.getLastRow() > 1) {
    var pData  = projSheet.getDataRange().getValues();
    var pIdCol = pData[0].indexOf('案件ID');
    if (pIdCol >= 0) {
      for (var pi = 1; pi < pData.length; pi++) masterIds[String(pData[pi][pIdCol])] = true;
    }
  }

  var data      = wSheet.getDataRange().getDisplayValues();
  var headers   = data[0];
  var projIdCol = headers.indexOf('案件ID');
  var dateCol   = headers.indexOf('勤務日');
  var payCol    = headers.indexOf('税抜き支払');
  var memoCol   = headers.indexOf('備考');
  var tmpCol    = headers.indexOf('仮案件名');
  if (projIdCol < 0) return [];

  var isSpot = function(pid) {
    return pid === 'SPOT_GENERIC' || pid === '汎用スポット' ||
           pid.indexOf('SPOT_') === 0 || (!masterIds[pid] && pid !== '');
  };
  var getKey = function(row) {
    if (tmpCol  >= 0 && row[tmpCol])  return String(row[tmpCol]);
    if (memoCol >= 0 && row[memoCol]) return String(row[memoCol]);
    return String(row[projIdCol]);
  };

  var groups = {};
  for (var i = 1; i < data.length; i++) {
    var pid = String(data[i][projIdCol]);
    if (!pid || !isSpot(pid)) continue;
    var key = getKey(data[i]) || '（名称未設定）';
    if (!groups[key]) groups[key] = { tempSpotName: key, recordCount: 0, totalPayment: 0, dates: [] };
    groups[key].recordCount++;
    groups[key].totalPayment += Number(data[i][payCol] || 0);
    if (dateCol >= 0 && data[i][dateCol]) groups[key].dates.push(String(data[i][dateCol]).slice(0, 10));
  }

  return Object.values(groups).map(function(g) {
    var sorted = g.dates.slice().sort();
    return {
      tempSpotName: g.tempSpotName,
      recordCount:  g.recordCount,
      totalPayment: g.totalPayment,
      firstDate:    sorted[0] || '',
      lastDate:     sorted[sorted.length - 1] || '',
    };
  });
}

// ============================================================
// スポット案件をマスタへ昇格し勤務記録の案件IDを一括更新
// ============================================================
function promoteSpotToMaster(tempSpotName, clientId, salePrice, buyPrice, calcType) {
  if (!tempSpotName || !clientId) throw new Error('案件名と荷主IDは必須です');

  var s = ss();

  // 案件マスタの現状IDセットを先に取得（一括更新時の判定に使う）
  var masterIds = {};
  var projSheet = s.getSheetByName('案件マスタ');
  if (!projSheet) throw new Error('案件マスタシートが見つかりません');
  var projData    = projSheet.getDataRange().getValues();
  var projHeaders = projData[0];
  var projIdCol   = projHeaders.indexOf('案件ID');
  var nameColP    = projHeaders.indexOf('案件名');
  var cliColP     = projHeaders.indexOf('荷主ID');
  var calcColP    = projHeaders.indexOf('単価方式');
  if (projIdCol >= 0) {
    for (var pi = 1; pi < projData.length; pi++) masterIds[String(projData[pi][projIdCol])] = true;
  }

  // 新規案件ID発行（PROJ_YYYYMMDDHHmmss）
  var now   = new Date();
  var newId = 'PROJ_' + Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMddHHmmss');

  // 案件マスタへ追加
  var newRow = new Array(projHeaders.length).fill('');
  if (projIdCol >= 0) newRow[projIdCol] = newId;
  if (nameColP  >= 0) newRow[nameColP]  = tempSpotName;
  if (cliColP   >= 0) newRow[cliColP]   = clientId;
  if (calcColP  >= 0) newRow[calcColP]  = calcType || '個数制';
  projSheet.appendRow(newRow);

  // price_rulesシートへ単価ルールを追加
  var prSheet = s.getSheetByName('price_rules');
  if (!prSheet) {
    prSheet = s.insertSheet('price_rules');
    prSheet.appendRow(['案件ID', '売値単価', '買値単価', '計算方式', '登録日時']);
  }
  prSheet.appendRow([newId, Number(salePrice) || 0, Number(buyPrice) || 0, calcType || '個数制', now]);

  // 勤務記録の該当行を新IDへ一括更新
  var wSheet = s.getSheetByName('勤務記録');
  if (!wSheet) throw new Error('勤務記録シートが見つかりません');
  var wData    = wSheet.getDataRange().getValues();
  var wHeaders = wData[0];
  var wProjCol = wHeaders.indexOf('案件ID');
  var wMemoCol = wHeaders.indexOf('備考');
  var wTmpCol  = wHeaders.indexOf('仮案件名');
  if (wProjCol < 0) throw new Error('勤務記録に案件ID列が見つかりません');

  var isSpotRow = function(pid) {
    return pid === 'SPOT_GENERIC' || pid === '汎用スポット' ||
           pid.indexOf('SPOT_') === 0 || (!masterIds[pid] && pid !== '');
  };
  var getKey = function(row) {
    if (wTmpCol  >= 0 && row[wTmpCol])  return String(row[wTmpCol]);
    if (wMemoCol >= 0 && row[wMemoCol]) return String(row[wMemoCol]);
    return String(row[wProjCol]);
  };

  var updated = 0;
  for (var i = 1; i < wData.length; i++) {
    var pid = String(wData[i][wProjCol]);
    if (!isSpotRow(pid)) continue;
    if (getKey(wData[i]) === tempSpotName) {
      wSheet.getRange(i + 1, wProjCol + 1).setValue(newId);
      updated++;
    }
  }

  SpreadsheetApp.flush();
  return { ok: true, newProjectId: newId, projectName: tempSpotName, updatedRecords: updated };
}

// ============================================================
// デバッグ用
// ============================================================
function debugAll() {
  try {
    const r = getAllData('2026-05');
    Logger.log('売上件数: ' + r.sales.records.length);
    Logger.log('支払通知書件数: ' + r.payment.length);
    Logger.log('請求書件数: ' + r.invoice.length);
    Logger.log(JSON.stringify(r.sales.summary));
  } catch (e) {
    Logger.log('エラー: ' + e.message);
  }
}