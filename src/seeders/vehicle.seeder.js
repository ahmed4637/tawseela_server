require('dotenv').config();

const connectDB = require('../config/db');
const Vehicle = require('../models/vehicle.model');

const vehicles = [
  {
    name: 'توكتوك',
    code: 'tuktuk',
    category: 'passenger',
    description: 'مناسب للمشاوير القصيرة داخل المناطق والشوارع الضيقة',
    seatsCount: 3,
    maxLoadKg: 50,
    canCarryPassengers: true,
    canCarryGoods: false,
    allowedServices: ['instant_ride'],
    startPrice: 10,
    pricePerKm: 5,
    minPrice: 20,
    commission: {
      instantRidePercent: 12,
      scheduledRidePercent: 10,
      deliveryOrderPercent: 12,
    },
    requiresLicense: false,
    isActive: true,
    order: 1,
  },
  {
    name: 'تروسيكل',
    code: 'tricycle',
    category: 'goods',
    description: 'مناسب لنقل الطلبات والبضائع الخفيفة',
    seatsCount: 1,
    maxLoadKg: 300,
    canCarryPassengers: false,
    canCarryGoods: true,
    allowedServices: ['delivery_order'],
    startPrice: 15,
    pricePerKm: 6,
    minPrice: 30,
    commission: {
      instantRidePercent: 0,
      scheduledRidePercent: 0,
      deliveryOrderPercent: 12,
    },
    requiresLicense: false,
    isActive: true,
    order: 2,
  },
  {
    name: 'موتوسيكل',
    code: 'motorcycle',
    category: 'mixed',
    description: 'مناسب للطلبات السريعة والمشاوير الفردية القصيرة',
    seatsCount: 1,
    maxLoadKg: 25,
    canCarryPassengers: true,
    canCarryGoods: true,
    allowedServices: ['instant_ride', 'delivery_order'],
    startPrice: 10,
    pricePerKm: 5,
    minPrice: 20,
    commission: {
      instantRidePercent: 12,
      scheduledRidePercent: 0,
      deliveryOrderPercent: 12,
    },
    requiresLicense: false,
    isActive: true,
    order: 3,
  },
  {
    name: 'سيارة ملاكي',
    code: 'private_car',
    category: 'passenger',
    description: 'مناسبة للمشاوير داخل وخارج المدينة',
    seatsCount: 4,
    maxLoadKg: 80,
    canCarryPassengers: true,
    canCarryGoods: false,
    allowedServices: ['instant_ride', 'scheduled_ride'],
    startPrice: 20,
    pricePerKm: 8,
    minPrice: 40,
    commission: {
      instantRidePercent: 15,
      scheduledRidePercent: 12,
      deliveryOrderPercent: 0,
    },
    requiresLicense: true,
    isActive: true,
    order: 4,
  },
  {
    name: 'تمناية',
    code: 'eight_seater',
    category: 'passenger',
    description: 'مناسبة للعائلات والمجموعات الصغيرة',
    seatsCount: 8,
    maxLoadKg: 150,
    canCarryPassengers: true,
    canCarryGoods: false,
    allowedServices: ['instant_ride', 'scheduled_ride'],
    startPrice: 35,
    pricePerKm: 12,
    minPrice: 80,
    commission: {
      instantRidePercent: 15,
      scheduledRidePercent: 10,
      deliveryOrderPercent: 0,
    },
    requiresLicense: true,
    isActive: true,
    order: 5,
  },
  {
    name: 'ميكروباص',
    code: 'microbus',
    category: 'passenger',
    description: 'مناسب للحجوزات والرحلات الجماعية',
    seatsCount: 14,
    maxLoadKg: 250,
    canCarryPassengers: true,
    canCarryGoods: false,
    allowedServices: ['instant_ride', 'scheduled_ride'],
    startPrice: 50,
    pricePerKm: 15,
    minPrice: 120,
    commission: {
      instantRidePercent: 12,
      scheduledRidePercent: 10,
      deliveryOrderPercent: 0,
    },
    requiresLicense: true,
    isActive: true,
    order: 6,
  },
  {
    name: 'باص',
    code: 'bus',
    category: 'passenger',
    description: 'مناسب للرحلات الكبيرة والحجوزات الجماعية',
    seatsCount: 30,
    maxLoadKg: 500,
    canCarryPassengers: true,
    canCarryGoods: false,
    allowedServices: ['scheduled_ride'],
    startPrice: 100,
    pricePerKm: 25,
    minPrice: 300,
    commission: {
      instantRidePercent: 0,
      scheduledRidePercent: 10,
      deliveryOrderPercent: 0,
    },
    requiresLicense: true,
    isActive: true,
    order: 7,
  },
  {
    name: 'ربع نقل',
    code: 'quarter_ton_pickup',
    category: 'goods',
    description: 'مناسب لنقل البضائع المتوسطة',
    seatsCount: 2,
    maxLoadKg: 750,
    canCarryPassengers: false,
    canCarryGoods: true,
    allowedServices: ['delivery_order', 'scheduled_ride'],
    startPrice: 60,
    pricePerKm: 16,
    minPrice: 120,
    commission: {
      instantRidePercent: 0,
      scheduledRidePercent: 10,
      deliveryOrderPercent: 12,
    },
    requiresLicense: true,
    isActive: true,
    order: 8,
  },
  {
    name: 'نص نقل',
    code: 'half_ton_pickup',
    category: 'goods',
    description: 'مناسب لنقل البضائع الأكبر',
    seatsCount: 2,
    maxLoadKg: 1500,
    canCarryPassengers: false,
    canCarryGoods: true,
    allowedServices: ['delivery_order', 'scheduled_ride'],
    startPrice: 80,
    pricePerKm: 20,
    minPrice: 180,
    commission: {
      instantRidePercent: 0,
      scheduledRidePercent: 10,
      deliveryOrderPercent: 12,
    },
    requiresLicense: true,
    isActive: true,
    order: 9,
  },
];

const seedVehicles = async () => {
  try {
    await connectDB();

    for (const vehicle of vehicles) {
      await Vehicle.findOneAndUpdate(
        { code: vehicle.code },
        vehicle,
        {
          upsert: true,
          new: true,
          runValidators: true,
        }
      );
    }

    console.log('Vehicles seeded successfully');
    process.exit(0);
  } catch (error) {
    console.error('Vehicles seeder error:', error);
    process.exit(1);
  }
};

seedVehicles();