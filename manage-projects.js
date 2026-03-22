#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const projectsPath = path.join(__dirname, 'projects.json');

function loadProjects() {
  return JSON.parse(fs.readFileSync(projectsPath, 'utf8'));
}

function saveProjects(projects) {
  fs.writeFileSync(projectsPath, JSON.stringify(projects, null, 2) + '\n');
}

function getNextId(projects) {
  return projects.length > 0 ? Math.max(...projects.map(p => p.id)) + 1 : 1;
}

async function getUserInput(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function addProject() {
  const projects = loadProjects();
  
  console.log('\n📝 Ajouter un nouveau projet\n');
  
  const title = await getUserInput('Titre: ');
  const description = await getUserInput('Description: ');
  const image = await getUserInput('Nom image (ex: project.webp): ');
  const tagsStr = await getUserInput('Tags (séparés par des virgules): ');
  const tags = tagsStr.split(',').map(t => t.trim());
  const featured = await getUserInput('Featured? (y/n): ');
  const chipsStr = await getUserInput('Chips (séparés par des virgules, ou vide): ');
  const chips = chipsStr ? chipsStr.split(',').map(c => c.trim()) : [];

  const newProject = {
    id: getNextId(projects),
    featured: featured.toLowerCase() === 'y',
    title,
    description,
    image,
    tags,
    ...(chips.length > 0 && { chips })
  };

  projects.push(newProject);
  saveProjects(projects);
  
  console.log(`\n✅ Projet ajouté avec l'ID ${newProject.id}\n`);
}

async function removeProject() {
  const projects = loadProjects();
  
  console.log('\n🗑️  Supprimer un projet\n');
  console.log('Projets disponibles:');
  projects.forEach(p => console.log(`  [${p.id}] ${p.title}`));
  
  const idStr = await getUserInput('\nID du projet à supprimer: ');
  const id = parseInt(idStr);
  
  const index = projects.findIndex(p => p.id === id);
  if (index === -1) {
    console.log('❌ Projet non trouvé\n');
    return;
  }
  
  const removed = projects.splice(index, 1);
  saveProjects(projects);
  
  console.log(`\n✅ Projet "${removed[0].title}" supprimé\n`);
}

async function listProjects() {
  const projects = loadProjects();
  
  console.log('\n📋 Liste des projets\n');
  projects.forEach(p => {
    const featured = p.featured ? '⭐' : '  ';
    console.log(`${featured} [${p.id}] ${p.title}`);
  });
  console.log('');
}

async function toggleFeatured() {
  const projects = loadProjects();
  
  console.log('\n⭐ Toggle featured\n');
  console.log('Projets disponibles:');
  projects.forEach(p => {
    const featured = p.featured ? '⭐' : '  ';
    console.log(`${featured} [${p.id}] ${p.title}`);
  });
  
  const idStr = await getUserInput('\nID du projet: ');
  const id = parseInt(idStr);
  
  const project = projects.find(p => p.id === id);
  if (!project) {
    console.log('❌ Projet non trouvé\n');
    return;
  }
  
  project.featured = !project.featured;
  saveProjects(projects);
  
  const status = project.featured ? 'featured' : 'non-featured';
  console.log(`\n✅ Projet "${project.title}" est maintenant ${status}\n`);
}

async function reorderProjects() {
  const projects = loadProjects();
  
  console.log('\n🔄 Réorganiser les projets\n');
  console.log('Projets actuels:');
  projects.forEach((p, idx) => {
    const featured = p.featured ? '⭐' : '  ';
    console.log(`${featured} ${idx + 1}. [${p.id}] ${p.title}`);
  });
  
  const orderStr = await getUserInput('\nNouvel ordre (IDs séparés par des virgules): ');
  const newOrder = orderStr.split(',').map(x => parseInt(x.trim()));
  
  const newProjects = newOrder.map(id => projects.find(p => p.id === id)).filter(p => p);
  
  if (newProjects.length !== projects.length) {
    console.log('❌ IDs invalides\n');
    return;
  }
  
  saveProjects(newProjects);
  console.log(`\n✅ Ordre des projets mis à jour\n`);
}

async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case 'add':
      await addProject();
      break;
    case 'remove':
      await removeProject();
      break;
    case 'list':
      await listProjects();
      break;
    case 'toggle':
      await toggleFeatured();
      break;
    case 'reorder':
      await reorderProjects();
      break;
    default:
      console.log(`
⚡ Gestion des projets

Commandes:
  node manage-projects.js list      Afficher tous les projets
  node manage-projects.js add       Ajouter un projet
  node manage-projects.js remove    Supprimer un projet
  node manage-projects.js toggle    Mettre en featured/non-featured
  node manage-projects.js reorder   Réorganiser les projets
      `);
  }
}

main().catch(console.error);
