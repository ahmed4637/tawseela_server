const mongoose = require('mongoose');

const promoRedemptionSchema = new mongoose.Schema(
  {
    promoCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PromoCode',
      required: true,
      index: true,
    },

    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true,
    },

    accountRole: {
      type: String,
      enum: ['customer', 'driver'],
      required: true,
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
      index: true,
    },

    serviceOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceOffer',
      default: null,
      index: true,
    },

    penaltyLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PenaltyLog',
      default: null,
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    appliedTo: {
      type: String,
      enum: ['customer_fare', 'driver_commission', 'driver_debt', 'coupon_removal'],
      required: true,
    },

    status: {
      type: String,
      enum: ['reserved', 'applied', 'cancelled', 'removed_by_penalty'],
      default: 'reserved',
      index: true,
    },

    reservedAt: {
      type: Date,
      default: Date.now,
    },

    appliedAt: {
      type: Date,
      default: null,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

promoRedemptionSchema.index({ promoCodeId: 1, accountId: 1, status: 1 });
promoRedemptionSchema.index({ serviceRequestId: 1, accountRole: 1, status: 1 });
promoRedemptionSchema.index({ serviceOfferId: 1, status: 1 });

promoRedemptionSchema.pre('validate', function normalizeCode() {
  if (this.code) {
    this.code = this.code.toString().trim().toUpperCase();
  }
});

promoRedemptionSchema.methods.toSafeObject = function () {
  const doc = this.toObject();
  delete doc.__v;
  return doc;
};

const PromoRedemption = mongoose.model('PromoRedemption', promoRedemptionSchema);

module.exports = PromoRedemption;
