const mongoose = require('mongoose');

const serviceOfferSchema = new mongoose.Schema(
  {
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: [true, 'رقم الطلب مطلوب'],
    },

    driverAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم حساب السائق مطلوب'],
    },

    driverVehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DriverVehicle',
      required: [true, 'رقم مركبة السائق مطلوب'],
    },

    offeredPrice: {
      type: Number,
      required: [true, 'السعر المعروض مطلوب'],
      min: 0,
    },

    message: {
      type: String,
      trim: true,
      default: '',
      maxlength: [500, 'رسالة العرض طويلة جدًا'],
    },

    driverPromoCodeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PromoCode',
      default: null,
    },

    driverPromoCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },

    driverPromoSnapshot: {
      type: Object,
      default: null,
    },

    estimatedDriverPromoDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected', 'cancelled', 'expired'],
      default: 'pending',
    },

    sentBy: {
      type: String,
      enum: ['driver', 'customer'],
      default: 'driver',
    },

    parentOfferId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceOffer',
      default: null,
    },

    acceptedAt: {
      type: Date,
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    expiredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

serviceOfferSchema.index({ serviceRequestId: 1, createdAt: -1 });
serviceOfferSchema.index({ driverAccountId: 1, status: 1 });
serviceOfferSchema.index({ driverPromoCodeId: 1 });
serviceOfferSchema.index(
  { serviceRequestId: 1, driverAccountId: 1, status: 1 },
  {
    partialFilterExpression: {
      status: 'pending',
    },
  }
);

serviceOfferSchema.methods.toSafeObject = function () {
  const offer = this.toObject();

  delete offer.__v;

  return offer;
};

const ServiceOffer = mongoose.model('ServiceOffer', serviceOfferSchema);

module.exports = ServiceOffer;