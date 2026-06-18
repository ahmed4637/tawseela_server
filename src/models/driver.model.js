const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const driverSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم السائق مطلوب'],
      trim: true,
      minlength: [2, 'اسم السائق قصير جدًا'],
      maxlength: [80, 'اسم السائق طويل جدًا'],
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },

    phone: {
      type: String,
      required: [true, 'رقم الهاتف مطلوب'],
      trim: true,
      unique: true,
      match: [
        /^(010|011|012|015)\d{8}$/,
        'رقم الهاتف يجب أن يكون رقم مصري صحيح',
      ],
    },

    password: {
      type: String,
      required: [true, 'كلمة المرور مطلوبة'],
      minlength: [6, 'كلمة المرور يجب ألا تقل عن 6 أحرف'],
      select: false,
    },

    role: {
      type: String,
      enum: ['driver'],
      default: 'driver',
    },

    vehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      default: null,
    },

    carModel: {
      type: String,
      trim: true,
      default: '',
    },

    carNumber: {
      type: String,
      trim: true,
      default: '',
    },

    licenseImage: {
      type: String,
      default: '',
    },

    nationalIdImage: {
      type: String,
      default: '',
    },

    isApproved: {
      type: Boolean,
      default: false,
    },

    isOnline: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    currentLat: {
      type: Number,
      default: null,
    },

    currentLng: {
      type: Number,
      default: null,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

driverSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

driverSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

driverSchema.methods.toSafeObject = function () {
  const driver = this.toObject();

  delete driver.password;
  delete driver.__v;

  return driver;
};

const Driver = mongoose.model('Driver', driverSchema);

module.exports = Driver;