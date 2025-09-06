// Arquivo: prisma/seed.js (Versão Final Alinhada com o Schema)

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando o processo de seeding...');

  // A ordem de exclusão está correta: primeiro os que dependem (Investment), depois os que são dependidos (Plan).
  await prisma.investment.deleteMany({});
  console.log('Investimentos de teste antigos removidos.');

  await prisma.plan.deleteMany({});
  console.log('Planos antigos removidos.');

  console.log('Criando os 7 planos padrão...');
  const plans = [
    // ✅ CORRIGIDO: Renomeado "dailyReturn" para "dailyYield" para corresponder ao schema.prisma
    { name: 'Plano Cobre',   price: 50.00,    dailyYield: 4.0, durationDays: 40 },
    { name: 'Plano Bronze',  price: 100.00,   dailyYield: 4.0, durationDays: 40 },
    { name: 'Plano Prata',   price: 300.00,   dailyYield: 4.0, durationDays: 40 },
    { name: 'Plano Ouro',    price: 500.00,   dailyYield: 4.0, durationDays: 40 },
    { name: 'Plano Platina', price: 1000.00,  dailyYield: 4.0, durationDays: 40 },
    { name: 'Plano Diamante',price: 5000.00,  dailyYield: 4.0, durationDays: 40 },
    { name: 'Plano Lendário',price: 10000.00, dailyYield: 4.0, durationDays: 40 },
  ];

  // O Prisma automaticamente converte os números para o tipo Decimal do banco de dados.
  for (const plan of plans) {
    await prisma.plan.create({
      data: plan,
    });
    console.log(`Plano "${plan.name}" criado.`);
  }

  console.log('Seeding concluído com sucesso! 🎉');
}

main()
  .catch((e) => {
    console.error('Ocorreu um erro durante o seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });