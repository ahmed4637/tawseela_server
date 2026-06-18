const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const accountSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'اسم المستخدم مطلوب'],
      trim: true,
      minlength: [2, 'اسم المستخدم قصير جدًا'],
      maxlength: [80, 'اسم المستخدم طويل جدًا'],
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

    profileImage: {
      type: String,
      trim: true,
      default: '',
    },

    roles: {
      type: [String],
      enum: ['customer', 'driver', 'admin'],
      default: ['customer'],
    },

    defaultRole: {
      type: String,
      enum: ['customer', 'driver', 'admin'],
      default: 'customer',
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
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

accountSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $type: 'string', $ne: '' },
    },
  }
);

accountSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

accountSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

accountSchema.methods.hasRole = function (role) {
  return this.roles.includes(role);
};

accountSchema.methods.addRole = function (role) {
  if (!this.roles.includes(role)) {
    this.roles.push(role);
  }
};

accountSchema.methods.toSafeObject = function () {
  const account = this.toObject();

  delete account.password;
  delete account.__v;

  return account;
};

const Account = mongoose.model('Account', accountSchema);

module.exports = Account;