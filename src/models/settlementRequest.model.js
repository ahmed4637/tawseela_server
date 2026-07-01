const mongoose = require('mongoose');

const settlementRequestSchema = new mongoose.Schema(
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
      default: null,
    },

    settlementType: {
      type: String,
      enum: ['driver_pays_app', 'app_pays_driver', 'offset'],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    method: {
      type: String,
      enum: ['cash', 'wallet', 'bank_transfer', 'vodafone_cash', 'instapay', 'manual', 'offset'],
      default: 'cash',
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'completed', 'cancelled'],
      default: 'pending',
    },

    proofUrl: {
      type: String,
      trim: true,
      default: '',
    },

    note: {
      type: String,
      trim: true,
      default: '',
    },

    adminNote: {
      type: String,
      trim: true,
      default: '',
    },

    requestedByAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    reviewedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    completedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

settlementRequestSchema.index({ driverAccountId: 1, status: 1, createdAt: -1 });
settlementRequestSchema.index({ settlementType: 1, status: 1 });

const SettlementRequest = mongoose.model('SettlementRequest', settlementRequestSchema);

module.exports = SettlementRequest;
