const mongoose = require('mongoose');

const promoCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'كود الكوبون مطلوب'],
      trim: true,
      uppercase: true,
      unique: true,
    },

    title: {
      type: String,
      trim: true,
      default: '',
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    promoType: {
      type: String,
      enum: ['customer', 'driver'],
      required: [true, 'نوع الكوبون مطلوب'],
      index: true,
    },

    discountType: {
      type: String,
      enum: ['fixed', 'percentage'],
      required: [true, 'نوع الخصم مطلوب'],
    },

    discountValue: {
      type: Number,
      required: [true, 'قيمة الخصم مطلوبة'],
      min: 0,
    },

    maxDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    minFare: {
      type: Number,
      default: 0,
      min: 0,
    },

    serviceTypes: {
      type: [String],
      enum: ['instant_ride', 'scheduled_ride', 'delivery_order'],
      default: [],
    },

    vehicleTypeCodes: {
      type: [String],
      default: [],
      set: (items) =>
        Array.isArray(items)
          ? items.map((item) => item.toString().trim().toLowerCase()).filter(Boolean)
          : [],
    },

    targetAccountIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
      },
    ],

    blockedAccountIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Account',
      },
    ],

    usageLimitTotal: {
      type: Number,
      default: 0,
      min: 0,
    },

    usageLimitPerAccount: {
      type: Number,
      default: 1,
      min: 0,
    },

    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    startsAt: {
      type: Date,
      default: null,
    },

    endsAt: {
      type: Date,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },

    updatedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

promoCodeSchema.index({ promoType: 1, isActive: 1, startsAt: 1, endsAt: 1 });
promoCodeSchema.index({ serviceTypes: 1 });
promoCodeSchema.index({ vehicleTypeCodes: 1 });
promoCodeSchema.index({ targetAccountIds: 1 });
promoCodeSchema.index({ blockedAccountIds: 1 });

promoCodeSchema.pre('validate', function normalizeCode() {
  if (this.code) {
    this.code = this.code.toString().trim().toUpperCase();
  }
});

promoCodeSchema.methods.toSafeObject = function () {
  const doc = this.toObject();
  delete doc.__v;
  return doc;
};

const PromoCode = mongoose.model('PromoCode', promoCodeSchema);

module.exports = PromoCode;
