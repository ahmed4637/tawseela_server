const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
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

    role: {
      type: String,
      enum: ['customer'],
      default: 'customer',
    },

    isActive: {
      type: Boolean,
      default: true,
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

userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

userSchema.methods.comparePassword = async function (enteredPassword) {
  return bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toSafeObject = function () {
  const user = this.toObject();

  delete user.password;
  delete user.__v;

  return user;
};

const User = mongoose.model('User', userSchema);

module.exports = User;