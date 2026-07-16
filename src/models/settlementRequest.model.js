const mongoose = require('mongoose');

const destinationSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, trim: true, default: '' },
    method: {
      type: String,
      enum: ['wallet', 'instapay', 'bank_transfer', ''],
      default: '',
    },
    label: { type: String, trim: true, default: '' },
    provider: { type: String, trim: true, default: '' },
    bankName: { type: String, trim: true, default: '' },
    accountName: { type: String, trim: true, default: '' },
    accountNumber: { type: String, trim: true, default: '' },
    iban: { type: String, trim: true, default: '' },
    instapayAddress: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

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
      // Legacy values remain readable for old records, but new driver requests
      // are validated to wallet / instapay / bank_transfer only.
      enum: [
        'cash',
        'wallet',
        'bank_transfer',
        'vodafone_cash',
        'instapay',
        'manual',
        'offset',
      ],
      default: 'wallet',
    },

    destinationAccountId: {
      type: String,
      trim: true,
      default: '',
    },

    destinationSnapshot: {
      type: destinationSnapshotSchema,
      default: () => ({}),
    },

    senderReference: {
      type: String,
      trim: true,
      default: '',
    },

    clientRequestId: {
      type: String,
      trim: true,
      default: '',
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'processing', 'rejected', 'completed', 'cancelled'],
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

    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },

    debtBefore: {
      type: Number,
      default: 0,
      min: 0,
    },

    debtAfter: {
      type: Number,
      default: null,
      min: 0,
    },

    walletAppliedAt: {
      type: Date,
      default: null,
    },

    commissionsAppliedAt: {
      type: Date,
      default: null,
    },

    driverPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverPayment',
      default: null,
    },

    ledgerTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverLedgerTransaction',
      default: null,
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
  },
);

settlementRequestSchema.index({ driverAccountId: 1, status: 1, createdAt: -1 });
settlementRequestSchema.index({ settlementType: 1, status: 1 });
settlementRequestSchema.index(
  { driverAccountId: 1, clientRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: 'string', $gt: '' } },
  },
);

const SettlementRequest = mongoose.model('SettlementRequest', settlementRequestSchema);

module.exports = SettlementRequest;
