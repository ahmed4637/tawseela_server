require('dotenv').config();

const connectDB = require('../config/db');
const Account = require('../models/account.model');
const { ensureDefaultAdminRoles } = require('../services/adminAccess.service');

const seedAdmin = async () => {
  try {
    await connectDB();
    await ensureDefaultAdminRoles();

    const adminName = process.env.ADMIN_NAME || 'Tawseela Admin';
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tawseela.com';
    const adminPhone = process.env.ADMIN_PHONE || '01000000000';
    const adminPassword = process.env.ADMIN_PASSWORD || '123456';

    let admin = await Account.findOne({ phone: adminPhone }).select('+password');

    if (admin) {
      if (!admin.roles.includes('admin')) {
        admin.roles.push('admin');
      }

      admin.name = adminName;
      admin.email = adminEmail;
      admin.defaultRole = 'admin';
      admin.adminRoleKey = 'super_admin';
      admin.isSuperAdmin = true;
      admin.isActive = true;

      await admin.save();

      console.log('Admin account already exists and was updated');
      console.log(`Phone: ${adminPhone}`);
      process.exit(0);
    }

    admin = await Account.create({
      name: adminName,
      email: adminEmail,
      phone: adminPhone,
      password: adminPassword,
      roles: ['admin'],
      defaultRole: 'admin',
      adminRoleKey: 'super_admin',
      isSuperAdmin: true,
      isActive: true,
    });

    console.log('Admin account created successfully');
    console.log(`Phone: ${admin.phone}`);
    console.log(`Password: ${adminPassword}`);
    process.exit(0);
  } catch (error) {
    console.error('Admin seeder error:', error);
    process.exit(1);
  }
};

seedAdmin();