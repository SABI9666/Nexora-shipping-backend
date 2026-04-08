import { PrismaClient, Role, ShipmentStatus, OrderStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create admin user
  const adminPassword = await bcrypt.hash('Admin@123456', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@nexorashipping.com' },
    update: {},
    create: {
      email: 'admin@nexorashipping.com',
      password: adminPassword,
      firstName: 'Nexora',
      lastName: 'Admin',
      phone: '+1-555-0100',
      role: Role.ADMIN,
      isVerified: true,
    },
  });

  // Create demo customer
  const customerPassword = await bcrypt.hash('Customer@123', 12);
  const customer = await prisma.user.upsert({
    where: { email: 'customer@example.com' },
    update: {},
    create: {
      email: 'customer@example.com',
      password: customerPassword,
      firstName: 'John',
      lastName: 'Doe',
      phone: '+1-555-0101',
      role: Role.CUSTOMER,
      isVerified: true,
    },
  });

  // Create a demo order
  const order = await prisma.order.create({
    data: {
      orderNumber: 'NEX-2024-001',
      status: OrderStatus.SHIPPED,
      pickupAddress: '123 Main St',
      pickupCity: 'New York',
      pickupCountry: 'US',
      deliveryAddress: '456 Oak Ave',
      deliveryCity: 'Los Angeles',
      deliveryCountry: 'US',
      packageDescription: 'Electronics - Laptop',
      weight: 2.5,
      length: 40,
      width: 30,
      height: 10,
      declaredValue: 1200,
      price: 45.99,
      userId: customer.id,
    },
  });

  // Create a demo shipment
  const shipment = await prisma.shipment.create({
    data: {
      trackingNumber: 'NEX1234567890US',
      status: ShipmentStatus.IN_TRANSIT,
      origin: 'New York, NY, US',
      destination: 'Los Angeles, CA, US',
      currentLocation: 'Dallas, TX, US',
      weight: 2.5,
      description: 'Electronics - Laptop',
      carrier: 'Nexora Express',
      estimatedDelivery: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      userId: customer.id,
      orderId: order.id,
      events: {
        create: [
          {
            status: ShipmentStatus.PENDING,
            location: 'New York, NY, US',
            description: 'Shipment created and pending pickup',
            timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
          },
          {
            status: ShipmentStatus.PICKED_UP,
            location: 'New York, NY, US',
            description: 'Package picked up by courier',
            timestamp: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          },
          {
            status: ShipmentStatus.IN_TRANSIT,
            location: 'Philadelphia, PA, US',
            description: 'Package in transit to sorting facility',
            timestamp: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          },
          {
            status: ShipmentStatus.IN_TRANSIT,
            location: 'Dallas, TX, US',
            description: 'Package arrived at regional hub',
            timestamp: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          },
        ],
      },
    },
  });

  console.log('Seed completed:', { admin: admin.email, customer: customer.email, order: order.orderNumber, shipment: shipment.trackingNumber });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
