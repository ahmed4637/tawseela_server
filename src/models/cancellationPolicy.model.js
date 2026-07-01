const mongoose = require('mongoose');

const cancellationPolicySchema = new mongoose.Schema(
  {
    actorType: {
      type: String,
      enum: ['customer', 'driver'],
      required: [true, 'نوع المستخدم مطلوب'],
    },

    serviceType: {
      type: String,
      enum: ['all', 'instant_ride', 'scheduled_ride', 'delivery_order'],
      default: 'all',
    },

    beforeAcceptancePenaltyEnabled: {
      type: Boolean,
      default: false,
    },

    repeatedCancelLimit: {
      type: Number,
      default: 3,
      min: 1,
    },

    repeatedCancelWindowHours: {
      type: Number,
      default: 24,
      min: 1,
    },

    beforeAcceptanceBlockMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    afterAcceptanceBlockMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },

    loyaltyDeductionPoints: {
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

    isActive: {
      type: Boolean,
      default: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

cancellationPolicySchema.index(
  { actorType: 1, serviceType: 1 },
  { unique: true }
);
cancellationPolicySchema.index({ isActive: 1 });

cancellationPolicySchema.methods.toSafeObject = function () {
  const policy = this.toObject();

  delete policy.__v;

  return policy;
};

const CancellationPolicy = mongoose.model(
  'CancellationPolicy',
  cancellationPolicySchema
);

module.exports = CancellationPolicy;
