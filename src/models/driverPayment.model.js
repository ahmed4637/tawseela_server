const mongoose = require('mongoose');

const driverPaymentSchema = new mongoose.Schema(
  {
    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب السائق مطلوب'],
    },

    walletId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverWallet',
      default: null,
    },


    settlementRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SettlementRequest',
      default: null,
    },

    amount: {
      type: Number,
      required: [true, 'قيمة السداد مطلوبة'],
      min: [1, 'قيمة السداد يجب أن تكون أكبر من صفر'],
    },

    method: {
      type: String,
      enum: ['cash', 'wallet', 'bank_transfer', 'vodafone_cash', 'instapay', 'manual'],
      default: 'wallet',
    },

    status: {
      type: String,
      enum: ['confirmed', 'cancelled'],
      default: 'confirmed',
    },

    previousDebtAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    debtAfter: {
      type: Number,
      default: 0,
      min: 0,
    },

    receivedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      default: '',
    },


    senderReference: {
      type: String,
      trim: true,
      default: '',
    },

    proofUrl: {
      type: String,
      trim: true,
      default: '',
    },

    destinationSnapshot: {
      type: Object,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

driverPaymentSchema.index({
  driverAccountId: 1,
  createdAt: -1,
});

driverPaymentSchema.index({ walletId: 1, createdAt: -1 });

driverPaymentSchema.index(
  { settlementRequestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      settlementRequestId: { $type: 'objectId' },
    },
  },
);

const DriverPayment = mongoose.model('DriverPayment', driverPaymentSchema);

module.exports = DriverPayment;
