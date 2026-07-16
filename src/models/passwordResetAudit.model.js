const mongoose = require('mongoose');

const passwordResetAuditSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    firebaseUid: {
      type: String,
      required: true,
      trim: true,
    },

    authenticatedAt: {
      type: Number,
      required: true,
    },

    tokenIssuedAt: {
      type: Number,
      required: true,
    },

    usedAt: {
      type: Date,
      required: true,
      default: Date.now,
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

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

passwordResetAuditSchema.index(
  { firebaseUid: 1, authenticatedAt: 1 },
  { unique: true }
);

passwordResetAuditSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

module.exports = mongoose.model(
  'PasswordResetAudit',
  passwordResetAuditSchema
);
