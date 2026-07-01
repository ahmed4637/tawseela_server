const mongoose = require('mongoose');

const SERVICE_TYPE_KEYS = ['instant_ride', 'scheduled_ride', 'delivery_order'];

const serviceTypeSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, 'كود الخدمة مطلوب'],
      enum: SERVICE_TYPE_KEYS,
      trim: true,
      lowercase: true,
      unique: true,
    },

    nameAr: {
      type: String,
      required: [true, 'اسم الخدمة بالعربي مطلوب'],
      trim: true,
    },

    nameEn: {
      type: String,
      trim: true,
      default: '',
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    iconUrl: {
      type: String,
      trim: true,
      default: '',
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    allowNegotiation: {
      type: Boolean,
      default: true,
    },

    allowCustomerCoupon: {
      type: Boolean,
      default: true,
    },

    allowDriverCoupon: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
      min: 0,
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

serviceTypeSchema.index({ isActive: 1, sortOrder: 1 });

serviceTypeSchema.methods.toSafeObject = function () {
  const serviceType = this.toObject();
  delete serviceType.__v;
  return serviceType;
};

const ServiceType = mongoose.model('ServiceType', serviceTypeSchema);

module.exports = {
  ServiceType,
  SERVICE_TYPE_KEYS,
};
