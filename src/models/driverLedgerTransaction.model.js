const mongoose = require('mongoose');

const driverLedgerTransactionSchema = new mongoose.Schema(
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

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
    },

    commissionTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommissionTransaction',
      default: null,
    },

    driverPaymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverPayment',
      default: null,
    },

    settlementRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SettlementRequest',
      default: null,
    },

    type: {
      type: String,
      enum: [
        'trip_fare_recorded',
        'customer_cash_collected',
        'app_covered_discount_receivable',
        'gross_commission_debt',
        'driver_coupon_discount',
        'driver_payment_to_app',
        'app_payment_to_driver',
        'admin_adjustment',
        'debt_snapshot',
      ],
      required: true,
    },

    direction: {
      type: String,
      enum: ['credit', 'debit', 'neutral'],
      required: true,
    },

    affects: {
      type: String,
      enum: ['payable_balance', 'debt', 'stats_only', 'both'],
      default: 'stats_only',
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    payableBalanceAfter: {
      type: Number,
      default: 0,
      min: 0,
    },

    debtAfter: {
      type: Number,
      default: 0,
      min: 0,
    },

    transactionKey: {
      type: String,
      trim: true,
      required: true,
      unique: true,
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    metadata: {
      type: Object,
      default: null,
    },

    createdBy: {
      type: String,
      enum: ['system', 'admin', 'driver'],
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

driverLedgerTransactionSchema.index({ driverAccountId: 1, createdAt: -1 });
driverLedgerTransactionSchema.index({ serviceRequestId: 1, type: 1 });
driverLedgerTransactionSchema.index({ settlementRequestId: 1 });

const DriverLedgerTransaction = mongoose.model(
  'DriverLedgerTransaction',
  driverLedgerTransactionSchema
);

module.exports = DriverLedgerTransaction;
