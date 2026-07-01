const mongoose = require('mongoose');

const driverDebtSnapshotSchema = new mongoose.Schema(
  {
    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    driverProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverProfile',
      default: null,
    },

    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverWallet',
      required: true,
    },

    payableBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    debtAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    netBalance: {
      type: Number,
      default: 0,
    },

    periodType: {
      type: String,
      enum: ['daily', 'weekly', 'monthly', 'manual'],
      default: 'manual',
    },

    periodStart: {
      type: Date,
      default: null,
    },

    periodEnd: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: String,
      enum: ['system', 'admin'],
      default: 'system',
    },

    adminAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

driverDebtSnapshotSchema.index({ driverAccountId: 1, createdAt: -1 });
driverDebtSnapshotSchema.index({ periodType: 1, periodStart: 1, periodEnd: 1 });

const DriverDebtSnapshot = mongoose.model('DriverDebtSnapshot', driverDebtSnapshotSchema);

module.exports = DriverDebtSnapshot;
