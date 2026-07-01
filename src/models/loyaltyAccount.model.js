const mongoose = require('mongoose');

const loyaltyAccountSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم الحساب مطلوب'],
    },

    accountRole: {
      type: String,
      enum: ['customer', 'driver'],
      required: [true, 'نوع حساب الولاء مطلوب'],
    },

    pointsBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalEarned: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalDeducted: {
      type: Number,
      default: 0,
      min: 0,
    },

    tier: {
      type: String,
      enum: ['bronze', 'silver', 'gold', 'platinum'],
      default: 'bronze',
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

loyaltyAccountSchema.index({ accountId: 1, accountRole: 1 }, { unique: true });
loyaltyAccountSchema.index({ accountRole: 1, pointsBalance: -1 });
loyaltyAccountSchema.index({ tier: 1 });

loyaltyAccountSchema.methods.toSafeObject = function () {
  const account = this.toObject();

  delete account.__v;

  return account;
};

const LoyaltyAccount = mongoose.model('LoyaltyAccount', loyaltyAccountSchema);

module.exports = LoyaltyAccount;
