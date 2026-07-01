const mongoose = require('mongoose');

const accountRestrictionSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم الحساب مطلوب'],
    },

    restrictionType: {
      type: String,
      enum: [
        'app_usage',
        'creating_requests',
        'driver_online',
        'receiving_requests',
        'admin_manual',
      ],
      required: [true, 'نوع الحظر مطلوب'],
    },

    reason: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'سبب الحظر طويل جدًا'],
    },

    startsAt: {
      type: Date,
      default: Date.now,
    },

    endsAt: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    source: {
      type: String,
      enum: ['system', 'admin'],
      default: 'system',
    },

    penaltyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PenaltyLog',
      default: null,
    },

    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      default: null,
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

    deactivatedAt: {
      type: Date,
      default: null,
    },

    deactivatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    deactivateReason: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

accountRestrictionSchema.index({ accountId: 1, isActive: 1, endsAt: 1 });
accountRestrictionSchema.index({ restrictionType: 1, isActive: 1 });
accountRestrictionSchema.index({ serviceRequestId: 1 });

accountRestrictionSchema.methods.isCurrentlyActive = function () {
  const now = new Date();

  return (
    this.isActive &&
    (!this.startsAt || this.startsAt <= now) &&
    (!this.endsAt || this.endsAt > now)
  );
};

accountRestrictionSchema.methods.toSafeObject = function () {
  const restriction = this.toObject();

  delete restriction.__v;

  return restriction;
};

const AccountRestriction = mongoose.model(
  'AccountRestriction',
  accountRestrictionSchema
);

module.exports = AccountRestriction;
