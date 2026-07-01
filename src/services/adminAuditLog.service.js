const AdminAuditLog = require('../models/adminAuditLog.model');

const normalizeForAudit = (value) => {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  try {
    const plainValue = value?.toObject && typeof value.toObject === 'function'
      ? value.toObject()
      : value;

    return JSON.parse(JSON.stringify(plainValue));
  } catch (error) {
    return {
      auditSerializationError: true,
      message: error.message,
    };
  }
};

const getNestedValue = (object, path) => {
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }

    return current[key];
  }, object);
};

const collectChangedFields = ({ oldValue, newValue }) => {
  const oldObject = oldValue && typeof oldValue === 'object' ? oldValue : {};
  const newObject = newValue && typeof newValue === 'object' ? newValue : {};
  const changed = new Set();

  const walk = (oldPart, newPart, prefix = '') => {
    const oldKeys = oldPart && typeof oldPart === 'object' && !Array.isArray(oldPart)
      ? Object.keys(oldPart)
      : [];

    const newKeys = newPart && typeof newPart === 'object' && !Array.isArray(newPart)
      ? Object.keys(newPart)
      : [];

    const keys = new Set([...oldKeys, ...newKeys]);

    for (const key of keys) {
      if (key === '__v' || key === 'updatedAt') {
        continue;
      }

      const path = prefix ? `${prefix}.${key}` : key;
      const oldChild = getNestedValue(oldObject, path);
      const newChild = getNestedValue(newObject, path);

      const bothObjects =
        oldChild &&
        newChild &&
        typeof oldChild === 'object' &&
        typeof newChild === 'object' &&
        !Array.isArray(oldChild) &&
        !Array.isArray(newChild);

      if (bothObjects) {
        walk(oldChild, newChild, path);
        continue;
      }

      if (JSON.stringify(oldChild) !== JSON.stringify(newChild)) {
        changed.add(path);
      }
    }
  };

  walk(oldObject, newObject);

  return Array.from(changed).sort();
};

const getClientIp = (req) => {
  const forwardedFor = req.headers['x-forwarded-for'];

  if (forwardedFor) {
    return forwardedFor.toString().split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || '';
};

const createAdminAuditLog = async ({
  req,
  module,
  action,
  entityType,
  entityId = null,
  oldValue = null,
  newValue = null,
  reason = '',
  metadata = {},
}) => {
  const safeOldValue = normalizeForAudit(oldValue);
  const safeNewValue = normalizeForAudit(newValue);

  const log = await AdminAuditLog.create({
    adminAccountId: req.accountId,
    adminRole: req.role || req.account?.defaultRole || 'admin',
    module,
    action,
    entityType,
    entityId,
    oldValue: safeOldValue,
    newValue: safeNewValue,
    changedFields: collectChangedFields({
      oldValue: safeOldValue,
      newValue: safeNewValue,
    }),
    ipAddress: getClientIp(req),
    userAgent: req.get('user-agent') || '',
    reason,
    metadata,
  });

  return log;
};

module.exports = {
  createAdminAuditLog,
  normalizeForAudit,
  collectChangedFields,
};
