const mongoose = require('mongoose');

const driverWalletSchema = new mongoose.Schema(
  {
    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      unique: true,
    },

    driverProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverProfile',
      default: null,
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

    debtLimit: {
      type: Number,
      default: 200,
      min: 0,
    },

    isBlockedByDebt: {
      type: Boolean,
      default: false,
    },

    totalTripFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalCustomerPaidToDriver: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalAppCoveredDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalGrossCommission: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalDriverPromoDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalNetCommission: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalPaidToApp: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalPaidToDriver: {
      type: Number,
      default: 0,
      min: 0,
    },

    lastDebtSnapshotAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

driverWalletSchema.virtual('netBalance').get(function () {
  return Math.round((Number(this.payableBalance || 0) - Number(this.debtAmount || 0)) * 100) / 100;
});

driverWalletSchema.methods.refreshDebtBlockStatus = function () {
  this.isBlockedByDebt = Number(this.debtAmount || 0) >= Number(this.debtLimit || 0);
};

driverWalletSchema.methods.toJSON = function () {
  const wallet = this.toObject({ virtuals: true });
  delete wallet.__v;
  return wallet;
};

driverWalletSchema.index({ debtAmount: -1, isBlockedByDebt: 1 });

const DriverWallet = mongoose.model('DriverWallet', driverWalletSchema);

module.exports = DriverWallet;
