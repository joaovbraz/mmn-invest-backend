// Arquivo: prisma/fixReferralCodes.js

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('Procurando por usuários sem código de convite...');
  const usersWithoutCode = await prisma.user.findMany({
    where: { referralCode: null },
  });

  if (usersWithoutCode.length === 0) {
    console.log('Todos os usuários já têm um código. Nada a fazer.');
    return;
  }

  console.log(`Encontrados ${usersWithoutCode.length} usuários para corrigir.`);

  for (const user of usersWithoutCode) {
    // Gera um código de convite aleatório, igual fazemos no cadastro
    const newReferralCode = (user.name.substring(0, 4).toUpperCase() || 'USER') + Math.random().toString().slice(2, 7);
    
    await prisma.user.update({
      where: { id: user.id },
      data: { referralCode: newReferralCode },
    });
    console.log(`-> Código ${newReferralCode} gerado para o usuário "${user.name}" (ID: ${user.id}).`);
  }

  console.log('Correção concluída com sucesso!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });