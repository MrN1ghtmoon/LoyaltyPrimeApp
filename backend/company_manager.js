const readline = require('readline');
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    password: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'loyalty_prime'
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query) => new Promise(resolve => rl.question(query, resolve));

// Функция для синхронизации последовательности ID
async function syncSequence() {
    const result = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM companies');
    const maxId = parseInt(result.rows[0].max_id);
    
    if (maxId === 0) {
        await pool.query('ALTER SEQUENCE companies_id_seq RESTART WITH 1');
        console.log('✅ Последовательность сброшена на 1 (таблица пуста)');
    } else {
        await pool.query(`SELECT setval('companies_id_seq', $1)`, [maxId]);
        console.log(`✅ Последовательность установлена на ${maxId}`);
    }
}

// Функция для создания компании (Mini App выключен по умолчанию)
async function createCompany() {
    console.log('\n📝 Создание новой компании\n');
    
    const company = await question('Название компании: ');
    const name = await question('Имя владельца: ');
    const email = await question('Email: ');
    const phone = await question('Телефон: ');
    const password = await question('Пароль: ');
    const brandColor = await question('Цвет бренда (например #2ecc71): ');
    const description = await question('Описание: ');
    
    if (!company || !name || !email || !password) {
        console.log('❌ Ошибка: Название, имя, email и пароль обязательны');
        return;
    }
    
    try {
        await syncSequence();
        
        // ✅ ТОЛЬКО mini_app_active = false (CRM всегда доступна)
        const result = await pool.query(
            `INSERT INTO companies (
                company, name, email, phone, password, brand_color, description, 
                mini_app_active, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW()) 
            RETURNING id, company, email, mini_app_active`,
            [company, name, email, phone || '', password, brandColor || '#2ecc71', description || '']
        );
        
        const companyId = result.rows[0].id;
        
        console.log(`\n✅ Компания "${company}" успешно создана!`);
        console.log(`   ID: ${companyId}`);
        console.log(`   Email: ${email}`);
        console.log(`   Пароль: ${password}`);
        console.log(`\n🔒 Статус VK Mini App: ВЫКЛЮЧЕН (заблокирован)`);
        console.log(`\n📌 Для активации программы лояльности:`);
        console.log(`   1. Войдите в CRM: http://localhost:3001`);
        console.log(`   2. Используйте email: ${email} и пароль: ${password}`);
        console.log(`   3. Перейдите в раздел "Настройки" → "VK Mini App"`);
        console.log(`   4. Включите переключатель "VK Mini App"`);
        console.log(`\n💡 После включения клиенты смогут пользоваться программой лояльности.`);
    } catch (error) {
        console.error('❌ Ошибка создания компании:', error.message);
    }
}

// Функция для удаления компании
async function deleteCompany() {
    const companies = await pool.query('SELECT id, company, email, mini_app_active FROM companies ORDER BY id');
    
    if (companies.rows.length === 0) {
        console.log('\n📭 Нет компаний в базе данных');
        return;
    }
    
    console.log('\n📋 Список компаний:');
    console.log('┌────┬──────────────────────────┬──────────────────────────┬──────────────┐');
    console.log('│ ID │ Название                 │ Email                    │ Mini App     │');
    console.log('├────┼──────────────────────────┼──────────────────────────┼──────────────┤');
    
    companies.rows.forEach(comp => {
        const name = (comp.company || '').substring(0, 24).padEnd(24);
        const email = (comp.email || '').substring(0, 24).padEnd(24);
        const status = comp.mini_app_active ? '🟢 Вкл' : '🔴 Выкл';
        console.log(`│ ${String(comp.id).padEnd(2)} │ ${name} │ ${email} │ ${status.padEnd(12)} │`);
    });
    
    console.log('└────┴──────────────────────────┴──────────────────────────┴──────────────┘');
    
    console.log('');
    const answer = await question('Введите ID компании для удаления: ');
    
    const companyId = parseInt(answer);
    if (isNaN(companyId)) {
        console.log('❌ Некорректный ID');
        return;
    }
    
    const company = await pool.query('SELECT id, company, email FROM companies WHERE id = $1', [companyId]);
    
    if (company.rows.length === 0) {
        console.log('❌ Компания с таким ID не найдена');
        return;
    }
    
    console.log(`\n⚠️ Вы собираетесь удалить компанию:`);
    console.log(`   Название: ${company.rows[0].company}`);
    console.log(`   Email: ${company.rows[0].email}`);
    
    const confirm = await question('\nУдалить? (yes/no): ');
    
    if (confirm.toLowerCase() === 'yes') {
        await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
        console.log('✅ Компания успешно удалена!');
        await syncSequence();
    } else {
        console.log('❌ Удаление отменено');
    }
}

// Функция для просмотра всех компаний
async function listCompanies() {
    const companies = await pool.query(
        'SELECT id, company, email, phone, mini_app_active, created_at FROM companies ORDER BY id'
    );
    
    if (companies.rows.length === 0) {
        console.log('\n📭 Нет компаний в базе данных');
        return;
    }
    
    console.log('\n📋 Список компаний:');
    console.log('┌────┬──────────────────────────┬──────────────────────────┬─────────────┬──────────────┐');
    console.log('│ ID │ Название                 │ Email                    │ Телефон     │ Mini App     │');
    console.log('├────┼──────────────────────────┼──────────────────────────┼─────────────┼──────────────┤');
    
    companies.rows.forEach(comp => {
        const name = (comp.company || '').substring(0, 24).padEnd(24);
        const email = (comp.email || '').substring(0, 24).padEnd(24);
        const phone = (comp.phone || '-').substring(0, 11).padEnd(11);
        const status = comp.mini_app_active ? '🟢 Включен' : '🔴 Выключен';
        console.log(`│ ${String(comp.id).padEnd(2)} │ ${name} │ ${email} │ ${phone} │ ${status.padEnd(12)} │`);
    });
    
    console.log('└────┴──────────────────────────┴──────────────────────────┴─────────────┴──────────────┘');
    console.log(`\n📊 Всего компаний: ${companies.rows.length}`);
    console.log(`   🟢 Включено (Mini App активен): ${companies.rows.filter(c => c.mini_app_active).length}`);
    console.log(`   🔴 Выключено (Mini App заблокирован): ${companies.rows.filter(c => !c.mini_app_active).length}`);
}

// Функция для включения/выключения Mini App (для администратора)
async function toggleMiniApp() {
    const companies = await pool.query('SELECT id, company, mini_app_active FROM companies ORDER BY id');
    
    if (companies.rows.length === 0) {
        console.log('\n📭 Нет компаний в базе данных');
        return;
    }
    
    console.log('\n📋 Список компаний:');
    companies.rows.forEach(comp => {
        const status = comp.mini_app_active ? '🟢 Включен' : '🔴 Выключен';
        console.log(`   ID: ${comp.id} | ${comp.company} | ${status}`);
    });
    
    console.log('');
    const answer = await question('Введите ID компании для изменения статуса Mini App: ');
    
    const companyId = parseInt(answer);
    if (isNaN(companyId)) {
        console.log('❌ Некорректный ID');
        return;
    }
    
    const company = await pool.query('SELECT id, company, mini_app_active FROM companies WHERE id = $1', [companyId]);
    
    if (company.rows.length === 0) {
        console.log('❌ Компания с таким ID не найдена');
        return;
    }
    
    const currentStatus = company.rows[0].mini_app_active;
    const newStatus = !currentStatus;
    
    console.log(`\n📌 Компания: ${company.rows[0].company}`);
    console.log(`   Текущий статус: ${currentStatus ? '🟢 Включен' : '🔴 Выключен'}`);
    console.log(`   Новый статус: ${newStatus ? '🟢 Включен' : '🔴 Выключен'}`);
    
    const confirm = await question('\nИзменить статус? (yes/no): ');
    
    if (confirm.toLowerCase() === 'yes') {
        await pool.query('UPDATE companies SET mini_app_active = $1 WHERE id = $2', [newStatus, companyId]);
        console.log(`✅ Статус Mini App изменён на ${newStatus ? 'Включен' : 'Выключен'}`);
    } else {
        console.log('❌ Изменение отменено');
    }
}

// Главное меню
async function showMenu() {
    console.clear();
    console.log('╔════════════════════════════════════════════╗');
    console.log('║     Управление компаниями                  ║');
    console.log('╠════════════════════════════════════════════╣');
    console.log('║  1. Показать все компании                  ║');
    console.log('║  2. Создать новую компанию                 ║');
    console.log('║  3. Удалить компанию                       ║');
    console.log('║  4. Включить/выключить Mini App            ║');
    console.log('║  5. Выход                                  ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');
}

// Основной цикл
async function main() {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Подключение к базе данных установлено\n');
        
        let running = true;
        
        while (running) {
            await showMenu();
            const choice = await question('Выберите действие (1-5): ');
            
            switch (choice) {
                case '1':
                    await listCompanies();
                    await question('\nНажмите Enter для продолжения...');
                    break;
                case '2':
                    await createCompany();
                    await question('\nНажмите Enter для продолжения...');
                    break;
                case '3':
                    await deleteCompany();
                    await question('\nНажмите Enter для продолжения...');
                    break;
                case '4':
                    await toggleMiniApp();
                    await question('\nНажмите Enter для продолжения...');
                    break;
                case '5':
                    console.log('\n👋 До свидания!');
                    running = false;
                    break;
                default:
                    console.log('\n❌ Неверный выбор. Попробуйте снова.');
                    await question('\nНажмите Enter для продолжения...');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        rl.close();
        await pool.end();
    }
}

// Запуск
main();