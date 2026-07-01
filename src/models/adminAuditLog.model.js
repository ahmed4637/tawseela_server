const mongoose = require('mongoose');

const adminAuditLogSchema = new mongoose.Schema(
  {
    adminAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب الأدمن مطلوب'],
    },

    adminRole: {
      type: String,
      trim: true,
      default: '',
    },

    module: {
      type: String,
      required: [true, 'اسم الموديول مطلوب'],
      trim: true,
      lowercase: true,
    },

    action: {
      type: String,
      required: [true, 'نوع العملية مطلوب'],
      trim: true,
      lowercase: true,
    },

    entityType: {
      type: String,
      required: [true, 'نوع العنصر مطلوب'],
      trim: true,
    },

    entityId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    oldValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    newValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    changedFields: {
      type: [String],
      default: [],
    },

    ipAddress: {
      type: String,
      trim: true,
      default: '',
    },

    userAgent: {
      type: String,
      trim: true,
      default: '',
    },

    reason: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'سبب التعديل طويل جدًا'],
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

adminAuditLogSchema.index({ adminAccountId: 1, createdAt: -1 });
adminAuditLogSchema.index({ module: 1, action: 1, createdAt: -1 });
adminAuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
adminAuditLogSchema.index({ createdAt: -1 });

adminAuditLogSchema.methods.toSafeObject = function () {
  const log = this.toObject();

  delete log.__v;

  return log;
};

const AdminAuditLog = mongoose.model('AdminAuditLog', adminAuditLogSchema);

module.exports = AdminAuditLog;
