import { PrismaClient, Role, ShipmentStatus, OrderStatus, AccountGroupType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const STANDARD_ACCOUNT_GROUPS: { code: string; name: string; groupType: AccountGroupType; printOrder: number }[] = [
  { code: 'BRA',   name: 'BRANCH',             groupType: AccountGroupType.ASSET,       printOrder: 10 },
  { code: 'CAP',   name: 'CAPITAL',            groupType: AccountGroupType.LIABILITIES, printOrder: 20 },
  { code: 'CASH',  name: 'CASH ACCOUNT',       groupType: AccountGroupType.ASSET,       printOrder: 30 },
  { code: 'COS',   name: 'COST OF SALES',      groupType: AccountGroupType.TRADING,     printOrder: 40 },
  { code: 'CA',    name: 'CURRENT ASSET',      groupType: AccountGroupType.ASSET,       printOrder: 50 },
  { code: 'CL',    name: 'CURRENT LIABILITY',  groupType: AccountGroupType.LIABILITIES, printOrder: 60 },
  { code: 'DEP',   name: 'DEPOSITS',           groupType: AccountGroupType.ASSET,       printOrder: 70 },
  { code: 'DEX',   name: 'DIRECT EXPENSES',    groupType: AccountGroupType.PL,          printOrder: 80 },
  { code: 'EMP',   name: 'EMPLOYEES',          groupType: AccountGroupType.ASSET,       printOrder: 90 },
  { code: 'EQU',   name: 'EQUITY',             groupType: AccountGroupType.LIABILITIES, printOrder: 100 },
  { code: 'FA',    name: 'FIXED ASSETS',       groupType: AccountGroupType.ASSET,       printOrder: 110 },
  { code: 'INC',   name: 'INCOME',             groupType: AccountGroupType.PL,          printOrder: 120 },
  { code: 'IEX',   name: 'INDIRECT EXPENSES',  groupType: AccountGroupType.PL,          printOrder: 130 },
  { code: 'IIN',   name: 'INDIRECT INCOMES',   groupType: AccountGroupType.PL,          printOrder: 140 },
  { code: 'ITADV', name: 'IT-ADV',             groupType: AccountGroupType.ASSET,       printOrder: 150 },
  { code: 'LADV',  name: 'LOANS & ADV.',       groupType: AccountGroupType.ASSET,       printOrder: 160 },
  { code: 'LAA',   name: 'LOANS AND ADVANCES', groupType: AccountGroupType.ASSET,       printOrder: 170 },
  { code: 'OPS',   name: 'OP. STOCK',          groupType: AccountGroupType.TRADING,     printOrder: 180 },
  { code: 'OTH',   name: 'OTHERS',             groupType: AccountGroupType.ASSET,       printOrder: 190 },
  { code: 'RNT',   name: 'RENT',               groupType: AccountGroupType.PL,          printOrder: 200 },
  { code: 'SADV',  name: 'SALARY ADVANCE',     groupType: AccountGroupType.ASSET,       printOrder: 210 },
  { code: 'SAL',   name: 'SALES',              groupType: AccountGroupType.TRADING,     printOrder: 220 },
  { code: 'STAX',  name: 'SALES TAX',          groupType: AccountGroupType.LIABILITIES, printOrder: 230 },
  { code: 'SHP',   name: 'SHIPPER',            groupType: AccountGroupType.ASSET,       printOrder: 240 },
  { code: 'STF',   name: 'STAFF',              groupType: AccountGroupType.ASSET,       printOrder: 250 },
  { code: 'SCR',   name: 'SUNDRY CREDITORS',   groupType: AccountGroupType.LIABILITIES, printOrder: 260 },
  { code: 'SDR',   name: 'SUNDRY DEBTORS',     groupType: AccountGroupType.ASSET,       printOrder: 270 },
  { code: 'TRD',   name: 'TRADING',            groupType: AccountGroupType.TRADING,     printOrder: 280 },
  { code: 'VATP',  name: 'VAT PAYABLE',        groupType: AccountGroupType.LIABILITIES, printOrder: 290 },
  { code: 'VATR',  name: 'VAT RECEIVABLE',     groupType: AccountGroupType.ASSET,       printOrder: 300 },
];

async function main() {
  console.log('Seeding database...');

  for (const g of STANDARD_ACCOUNT_GROUPS) {
    await prisma.accountGroup.upsert({
      where: { code: g.code },
      update: { name: g.name, groupType: g.groupType, printOrder: g.printOrder },
      create: g,
    });
  }
  console.log(`Seeded ${STANDARD_ACCOUNT_GROUPS.length} standard account groups`);

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
      orderNumber: `NEXDX-${new Date().getFullYear()}-00001`,
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
