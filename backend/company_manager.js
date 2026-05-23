const readline = require('readline');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

// Путь к файлу с заявками
const DEMO_REQUESTS_FILE = path.join(__dirname, 'demo_requests.json');

// Функция для генерации случайного пароля
function generateRandomPassword(length = 10) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

// Функция для синхронизации последовательности ID
async function syncSequence() {
    const result = await pool.query('SELECT COALESCE(MAX(id), 0) as max_id FROM companies');
    const maxId = parseInt(result.rows[0].max_id);
    
    if (maxId === 0) {
        await pool.query('ALTER SEQUENCE companies_id_seq RESTART WITH 1');
        console.log('✅ Последовательность сброшена на 1');
    } else {
        await pool.query(`SELECT setval('companies_id_seq', $1)`, [maxId]);
        console.log(`✅ Последовательность установлена на ${maxId}`);
    }
}

// Функция для создания компании из заявки
async function createCompanyFromRequest(request) {
    const generatedPassword = generateRandomPassword(10);
    
    console.log('\n📝 Создание компании из заявки:');
    console.log(`   Название: ${request.brandName}`);
    console.log(`   Владелец: ${request.owner}`);
    console.log(`   Email: ${request.email}`);
    console.log(`   Телефон: ${request.phone}`);
    console.log(`   Пароль: ${generatedPassword}`);
    
    try {
        await syncSequence();
        
        const result = await pool.query(
            `INSERT INTO companies (
                company, name, email, phone, password, brand_color, description, 
                mini_app_active, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW()) 
            RETURNING id, company, email`,
            [
                request.brandName, 
                request.owner, 
                request.email, 
                request.phone, 
                generatedPassword, 
                '#2ecc71', 
                `Добро пожаловать в ${request.brandName}!`
            ]
        );
        
        const companyId = result.rows[0].id;
        
        // Обновляем статус заявки
        await updateRequestStatus(request.id, 'completed', companyId);
        
        console.log(`\n✅ Компания "${request.brandName}" успешно создана!`);
        console.log(`   ID: ${companyId}`);
        console.log(`   Email: ${request.email}`);
        console.log(`   Пароль: ${generatedPassword}`);
        console.log(`\n📌 Данные сохранены в файл: компании_${companyId}.txt`);
        
        // Сохраняем данные в отдельный файл
        const companyFile = path.join(__dirname, `компаниям_${companyId}.txt`);
        fs.writeFileSync(companyFile, `
========================================
Данные для входа в CRM
========================================
Название компании: ${request.brandName}
Владелец: ${request.owner}
Email: ${request.email}
Телефон: ${request.phone}
Пароль: ${generatedPassword}
ID компании: ${companyId}
========================================
CRM: http://localhost:3001
========================================
        `.trim());
        
        console.log(`   Файл с данными: компаниям_${companyId}.txt`);
        
        return {
            success: true,
            companyId: companyId,
            email: request.email,
            password: generatedPassword,
            requestId: request.id
        };
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        await updateRequestStatus(request.id, 'failed');
        return {
            success: false,
            error: error.message,
            requestId: request.id
        };
    }
}

// Функция для обновления статуса заявки
async function updateRequestStatus(requestId, status, companyId = null) {
    try {
        if (!fs.existsSync(DEMO_REQUESTS_FILE)) return false;
        
        const fileContent = fs.readFileSync(DEMO_REQUESTS_FILE, 'utf8');
        const requests = JSON.parse(fileContent);
        
        const requestIndex = requests.findIndex(r => r.id == requestId);
        if (requestIndex === -1) return false;
        
        requests[requestIndex].status = status;
        if (companyId) requests[requestIndex].companyId = companyId;
        requests[requestIndex].processed_at = new Date().toISOString();
        
        fs.writeFileSync(DEMO_REQUESTS_FILE, JSON.stringify(requests, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('❌ Ошибка:', error);
        return false;
    }
}

// Функция для чтения заявок
async function readPendingRequests() {
    try {
        if (!fs.existsSync(DEMO_REQUESTS_FILE)) {
            console.log('\n📭 Файл demo_requests.json не найден');
            return [];
        }
        
        const fileContent = fs.readFileSync(DEMO_REQUESTS_FILE, 'utf8');
        const requests = JSON.parse(fileContent);
        
        return requests.filter(r => r.status === 'pending');
    } catch (error) {
        console.error('❌ Ошибка чтения:', error);
        return [];
    }
}

// Функция для просмотра всех заявок
async function listDemoRequests() {
    try {
        if (!fs.existsSync(DEMO_REQUESTS_FILE)) {
            console.log('\n📭 Файл demo_requests.json не найден');
            return;
        }
        
        const fileContent = fs.readFileSync(DEMO_REQUESTS_FILE, 'utf8');
        const requests = JSON.parse(fileContent);
        
        if (requests.length === 0) {
            console.log('\n📭 Нет заявок');
            return;
        }
        
        console.log('\n📋 Список демо-заявок:');
        console.log('┌─────┬──────────────────────────┬──────────────────────────┬─────────────┬──────────────┐');
        console.log('│ ID  │ Бренд                    │ Email                    │ Телефон     │ Статус       │');
        console.log('├─────┼──────────────────────────┼──────────────────────────┼─────────────┼──────────────┤');
        
        const statusMap = {
            'pending': '🟡 Ожидает',
            'processing': '🟠 В обработке',
            'completed': '🟢 Выполнена',
            'failed': '🔴 Ошибка'
        };
        
        requests.forEach(req => {
            const id = String(req.id).slice(-6).padEnd(4);
            const brand = (req.brandName || '').substring(0, 24).padEnd(24);
            const email = (req.email || '').substring(0, 24).padEnd(24);
            const phone = (req.phone || '').substring(0, 11).padEnd(11);
            const status = statusMap[req.status] || req.status;
            console.log(`│ ${id} │ ${brand} │ ${email} │ ${phone} │ ${status.padEnd(12)} │`);
        });
        
        console.log('└─────┴──────────────────────────┴──────────────────────────┴─────────────┴──────────────┘');
        console.log(`\n📊 Всего: ${requests.length}`);
        console.log(`   Ожидают: ${requests.filter(r => r.status === 'pending').length}`);
        console.log(`   Выполнено: ${requests.filter(r => r.status === 'completed').length}`);
        
    } catch (error) {
        console.error('❌ Ошибка:', error);
    }
}

// Функция для массового создания компаний
async function processAllPendingRequests() {
    const pendingRequests = await readPendingRequests();
    
    if (pendingRequests.length === 0) {
        console.log('\n📭 Нет заявок для обработки');
        return [];
    }
    
    console.log(`\n📋 Найдено ${pendingRequests.length} заявок\n`);
    
    const results = [];
    for (const request of pendingRequests) {
        console.log(`${'='.repeat(50)}`);
        console.log(`Обработка: ${request.brandName}`);
        
        await updateRequestStatus(request.id, 'processing');
        const result = await createCompanyFromRequest(request);
        results.push(result);
        
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return results;
}

// Функция для просмотра всех компаний
async function listCompanies() {
    const companies = await pool.query(
        'SELECT id, company, email, phone, mini_app_active, created_at FROM companies ORDER BY id'
    );
    
    if (companies.rows.length === 0) {
        console.log('\n📭 Нет компаний');
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
        const status = comp.mini_app_active ? '🟢 Вкл' : '🔴 Выкл';
        console.log(`│ ${String(comp.id).padEnd(2)} │ ${name} │ ${email} │ ${phone} │ ${status.padEnd(12)} │`);
    });
    
    console.log('└────┴──────────────────────────┴──────────────────────────┴─────────────┴──────────────┘');
    console.log(`\n📊 Всего: ${companies.rows.length}`);
}

// Функция для удаления компании
async function deleteCompany() {
    const companies = await pool.query('SELECT id, company, email FROM companies ORDER BY id');
    
    if (companies.rows.length === 0) {
        console.log('\n📭 Нет компаний');
        return;
    }
    
    console.log('\n📋 Список компаний:');
    companies.rows.forEach(comp => {
        console.log(`   ID: ${comp.id} | ${comp.company} | ${comp.email}`);
    });
    
    const answer = await question('\nВведите ID компании для удаления: ');
    const companyId = parseInt(answer);
    
    if (isNaN(companyId)) {
        console.log('❌ Некорректный ID');
        return;
    }
    
    const company = await pool.query('SELECT company FROM companies WHERE id = $1', [companyId]);
    if (company.rows.length === 0) {
        console.log('❌ Компания не найдена');
        return;
    }
    
    const confirm = await question(`\nУдалить "${company.rows[0].company}"? (yes/no): `);
    
    if (confirm.toLowerCase() === 'yes') {
        await pool.query('DELETE FROM companies WHERE id = $1', [companyId]);
        console.log('✅ Компания удалена');
        await syncSequence();
    } else {
        console.log('❌ Отменено');
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
    console.log('║  4. Просмотр демо-заявок                   ║');
    console.log('║  5. Создать компании из заявок             ║');
    console.log('║  6. Выход                                  ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log('');
}

// Основной цикл
async function main() {
    try {
        await pool.query('SELECT NOW()');
        console.log('✅ Подключение к базе данных\n');
        
        let running = true;
        
        while (running) {
            await showMenu();
            const choice = await question('Выберите действие (1-6): ');
            
            switch (choice) {
                case '1':
                    await listCompanies();
                    await question('\nНажмите Enter...');
                    break;
                case '2':
                    await createCompany();
                    await question('\nНажмите Enter...');
                    break;
                case '3':
                    await deleteCompany();
                    await question('\nНажмите Enter...');
                    break;
                case '4':
                    await listDemoRequests();
                    await question('\nНажмите Enter...');
                    break;
                case '5':
                    console.log('\n🔄 Обработка заявок...');
                    const results = await processAllPendingRequests();
                    console.log(`\n✅ Создано: ${results.filter(r => r.success).length}`);
                    console.log(`❌ Ошибок: ${results.filter(r => !r.success).length}`);
                    await question('\nНажмите Enter...');
                    break;
                case '6':
                    console.log('\n👋 До свидания!');
                    running = false;
                    break;
                default:
                    console.log('\n❌ Неверный выбор');
                    await question('\nНажмите Enter...');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.message);
    } finally {
        rl.close();
        await pool.end();
    }
}

main();