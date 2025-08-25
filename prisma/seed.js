// Arquivo: prisma/seed.js

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando o processo de seeding...');

  const plans = [
    { name: 'Plano Bronze', price: 100.00, dailyReturn: 1.0 },
    { name: 'Plano Prata', price: 300.00, dailyReturn: 1.1 },
    { name: 'Plano Ouro', price: 500.00, dailyReturn: 1.4 },
    { name: 'Plano Platina', price: 1000.00, dailyReturn: 1.7 },
    { name: 'Plano Diamante', price: 5000.00, dailyReturn: 2.0 },
    { name: 'Plano Lendário', price: 10000.00, dailyReturn: 2.3 },
  ];

  for (const plan of plans) {
    await prisma.plan.create({
      data: plan,
    });
    console.log(`Plano "${plan.name}" criado.`);
  }

  console.log('Seeding concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });