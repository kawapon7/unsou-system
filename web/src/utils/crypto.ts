import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; 
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function encryptText(text: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
    throw new Error('環境変数 ENCRYPTION_KEY が正しく設定されていません（32バイト必要です）。');
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptText(encryptedData: string): string {
  if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
    throw new Error('環境変数 ENCRYPTION_KEY が正しく設定されていません（32バイト必要です）。');
  }
  const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('暗号化データの形式が不正です。');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const BANK_FIELD_KEYS = ['bank_name', 'bank_branch', 'account_number', 'account_holder'] as const;
const ENCRYPTED_FORMAT = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

export function isEncryptedValue(value: string): boolean {
  return ENCRYPTED_FORMAT.test(value);
}

export function decryptBankFieldValue(value: string | null | undefined): string {
  if (!value) return '';
  if (!isEncryptedValue(value)) return value;
  try {
    return decryptText(value);
  } catch {
    return '（復号エラー）';
  }
}

export function encryptBankFields<T extends Record<string, unknown>>(payload: T): T {
  const result: Record<string, unknown> = { ...payload };
  for (const key of BANK_FIELD_KEYS) {
    const value = result[key];
    if (typeof value === 'string' && value.length > 0 && !isEncryptedValue(value)) {
      result[key] = encryptText(value);
    }
  }
  return result as T;
}

export function decryptBankFields<T extends Record<string, unknown>>(row: T): T {
  const result: Record<string, unknown> = { ...row };
  for (const key of BANK_FIELD_KEYS) {
    const value = result[key];
    if (typeof value === 'string') {
      result[key] = decryptBankFieldValue(value);
    }
  }
  return result as T;
}
