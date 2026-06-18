const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: [true, 'رقم الحساب مطلوب'],
    },

    name: {
      type: String,
      required: [true, 'اسم العنوان مطلوب'],
      trim: true,
      minlength: [2, 'اسم العنوان قصير جدًا'],
      maxlength: [80, 'اسم العنوان طويل جدًا'],
    },

    type: {
      type: String,
      enum: ['home', 'work', 'last_destination', 'custom'],
      default: 'custom',
    },

    address: {
      type: String,
      required: [true, 'وصف العنوان مطلوب'],
      trim: true,
      minlength: [3, 'وصف العنوان قصير جدًا'],
      maxlength: [300, 'وصف العنوان طويل جدًا'],
    },

    notes: {
      type: String,
      trim: true,
      maxlength: [300, 'ملاحظات العنوان طويلة جدًا'],
      default: '',
    },

    lng: {
      type: Number,
      required: [true, 'خط الطول مطلوب'],
    },

    lat: {
      type: Number,
      required: [true, 'خط العرض مطلوب'],
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

addressSchema.index(
  { accountId: 1, name: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isActive: true,
    },
  }
);

addressSchema.index({ accountId: 1, type: 1, isActive: 1 });
addressSchema.index({ accountId: 1, isActive: 1, order: 1, createdAt: -1 });

addressSchema.methods.toSafeObject = function () {
  const address = this.toObject();

  delete address.__v;

  return address;
};

const Address = mongoose.model('Address', addressSchema);

module.exports = Address;