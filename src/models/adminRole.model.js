const mongoose = require('mongoose');

const adminRoleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    nameAr: {
      type: String,
      required: true,
      trim: true,
    },

    nameEn: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      trim: true,
      default: '',
    },

    permissions: {
      type: [String],
      default: [],
    },

    isSystem: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
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

adminRoleSchema.index({ isActive: 1, isSystem: 1 });

const AdminRole = mongoose.model('AdminRole', adminRoleSchema);

module.exports = AdminRole;
