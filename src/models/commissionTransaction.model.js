const mongoose = require('mongoose');

const commissionTransactionSchema = new mongoose.Schema(
  {
    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
    },

    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverWallet',
      default: null,
    },

    ledgerTransactionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DriverLedgerTransaction',
      },
    ],

    type: {
      type: String,
      enum: ['commission'],
      default: 'commission',
    },

    serviceType: {
      type: String,
      enum: ['instant_ride', 'scheduled_ride', 'delivery_order'],
      required: true,
    },

    vehicleTypeCode: {
      type: String,
      trim: true,
      lowercase: true,
      required: true,
    },

    finalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    customerPayablePrice: {
      type: Number,
      default: 0,
      min: 0,
    },

    appCoveredDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    commissionPercent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    grossCommissionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    driverPromoDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    driverNetAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    paidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    paidAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ['unpaid', 'partial_paid', 'paid', 'cancelled'],
      default: 'unpaid',
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

commissionTransactionSchema.index(
  { serviceRequestId: 1, type: 1 },
  { unique: true },
);

commissionTransactionSchema.index({
  driverAccountId: 1,
  status: 1,
  createdAt: -1,
});

commissionTransactionSchema.index({ walletId: 1, createdAt: -1 });

const CommissionTransaction = mongoose.model(
  'CommissionTransaction',
  commissionTransactionSchema,
);

module.exports = CommissionTransaction;
