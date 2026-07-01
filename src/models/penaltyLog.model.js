const mongoose = require('mongoose');

const penaltyLogSchema = new mongoose.Schema(
  {
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

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
    },

    penaltyType: {
      type: String,
      enum: [
        'cancellation_after_acceptance',
        'repeated_cancellation_before_acceptance',
        'no_show',
        'manual_block',
        'warning',
      ],
      required: [true, 'نوع العقوبة مطلوب'],
    },

    phase: {
      type: String,
      enum: ['before_acceptance', 'after_acceptance', 'no_show', 'manual'],
      default: 'manual',
    },

    reason: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'سبب العقوبة طويل جدًا'],
    },

    blockMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    blockUntil: {
      type: Date,
      default: null,
    },

    restrictionIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'AccountRestriction',
      },
    ],

    loyaltyPointsDeducted: {
      type: Number,
      default: 0,
      min: 0,
    },

    removeDriverCoupons: {
      type: Boolean,
      default: false,
    },

    driverCouponRemoveMode: {
      type: String,
      enum: ['none', 'all', 'unused', 'campaign_specific'],
      default: 'none',
    },

    removedPromoIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PromoCode',
      },
    ],

    policySnapshot: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    createdBy: {
      type: String,
      enum: ['system', 'admin'],
      default: 'system',
    },

    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

penaltyLogSchema.index({ accountId: 1, createdAt: -1 });
penaltyLogSchema.index({ accountRole: 1, penaltyType: 1, createdAt: -1 });
penaltyLogSchema.index({ serviceRequestId: 1 });
penaltyLogSchema.index({ blockUntil: 1 });

penaltyLogSchema.methods.toSafeObject = function () {
  const penalty = this.toObject();

  delete penalty.__v;

  return penalty;
};

const PenaltyLog = mongoose.model('PenaltyLog', penaltyLogSchema);

module.exports = PenaltyLog;
