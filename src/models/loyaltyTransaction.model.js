const mongoose = require('mongoose');

const loyaltyTransactionSchema = new mongoose.Schema(
  {
    loyaltyAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LoyaltyAccount',
      required: [true, 'رقم حساب الولاء مطلوب'],
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم الحساب مطلوب'],
    },

    accountRole: {
      type: String,
      enum: ['customer', 'driver'],
      required: [true, 'نوع الحساب مطلوب'],
    },

    type: {
      type: String,
      enum: ['earn', 'spend', 'deduct', 'admin_adjust'],
      required: [true, 'نوع حركة النقاط مطلوب'],
    },

    direction: {
      type: String,
      enum: ['credit', 'debit'],
      required: [true, 'اتجاه الحركة مطلوب'],
    },

    points: {
      type: Number,
      required: [true, 'عدد النقاط مطلوب'],
      min: 0,
    },

    balanceBefore: {
      type: Number,
      required: true,
      min: 0,
    },

    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    reason: {
      type: String,
      trim: true,
      default: '',
    },

    source: {
      type: String,
      enum: [
        'completed_request',
        'cancellation_penalty',
        'admin_adjust',
        'manual',
      ],
      default: 'manual',
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
    },

    penaltyLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PenaltyLog',
      default: null,
    },

    promoRedemptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PromoRedemption',
      default: null,
    },

    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    transactionKey: {
      type: String,
      trim: true,
      default: '',
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

loyaltyTransactionSchema.index({ accountId: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ accountRole: 1, type: 1, createdAt: -1 });
loyaltyTransactionSchema.index({ serviceRequestId: 1 });
loyaltyTransactionSchema.index({ penaltyLogId: 1 });
loyaltyTransactionSchema.index(
  { transactionKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      transactionKey: { $type: 'string', $ne: '' },
    },
  }
);

loyaltyTransactionSchema.methods.toSafeObject = function () {
  const transaction = this.toObject();

  delete transaction.__v;

  return transaction;
};

const LoyaltyTransaction = mongoose.model(
  'LoyaltyTransaction',
  loyaltyTransactionSchema
);

module.exports = LoyaltyTransaction;
