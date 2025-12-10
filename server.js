// =======================================================
// 1. IMPORTACIONES Y CONFIGURACIÓN INICIAL
// =======================================================
const express = require('express');
const mysql = require('mysql2/promise');
const session = require('express-session');
// NOTA: 'bcrypt' ha sido removido porque el teléfono no es una contraseña.

const app = express();

// Puerto: Render asigna el puerto a process.env.PORT
const port = process.env.PORT || 3000;

// =======================================================
// 2. CONFIGURACIÓN DE BASE DE DATOS (TiDB Cloud)
// =======================================================
const DB_CONFIG_TIDB = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000, // Puerto de TiDB Cloud
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // CRÍTICO: Configuración SSL para TiDB Cloud
    ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true, 
    }
};

let pool;

// Función para inicializar y probar la conexión a la base de datos
async function connectToDatabase() {
    try {
        pool = mysql.createPool(DB_CONFIG_TIDB);
        const connection = await pool.getConnection();
        connection.release();
        console.log('✅ Conexión a la base de datos TiDB establecida correctamente.');
    } catch (error) {
        console.error('❌ Error al conectar a la base de datos TiDB:', error.message);
        // Si hay un error, el log en Render lo mostrará
    }
}

connectToDatabase();

// =======================================================
// 3. MIDDLEWARE
// =======================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // Para servir archivos HTML, CSS, JS del lado del cliente

// Configuración de Sesión
app.use(session({
    secret: process.env.SESSION_SECRET || 'CLAVE_SECRETA_POR_DEFECTO',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: true, // Importante para Render (HTTPS)
        httpOnly: true,
        maxAge: 3600000 // 1 hora
    }
}));


// Middleware para verificar si el usuario está autenticado
const isAuthenticated = (req, res, next) => {
    if (req.session.userId) {
        next();
    } else {
        // Redirigir al login si no está autenticado
        res.redirect('/'); 
    }
};

// =======================================================
// 4. RUTAS DE AUTENTICACIÓN Y SESIÓN (CORREGIDAS)
// =======================================================

// Ruta de Registro de Usuarios (CORREGIDA: Teléfono guardado en texto plano)
app.post('/registro', async (req, res) => {
    const { nombre, telefono, email } = req.body;

    if (!nombre || !telefono) {
        return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
    }

    try {
        // CORRECCIÓN: Se inserta el teléfono en texto plano, sin hashear.
        const query = 'INSERT INTO usuarios (nombre, telefono, email) VALUES (?, ?, ?)';
        const [result] = await pool.execute(query, [nombre, telefono, email]);

        // Iniciar sesión automáticamente
        req.session.userId = result.insertId;
        req.session.userName = nombre;

        res.status(200).json({ success: true, message: 'Registro exitoso.', redirect: '/canastas.html' });
    } catch (error) {
        console.error('Error al registrar usuario:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Este nombre y teléfono ya están registrados.' });
        }
        res.status(500).json({ error: 'Error interno del servidor al registrar.' });
    }
});

// Ruta de Ingreso (Login) (CORREGIDA: Búsqueda por Nombre y Teléfono)
app.post('/ingreso', async (req, res) => {
    const { nombre, telefono } = req.body;

    if (!nombre || !telefono) {
        return res.status(400).json({ error: 'Nombre y teléfono son obligatorios para ingresar.' });
    }

    try {
        // Buscar una coincidencia exacta de nombre y teléfono
        const query = 'SELECT id_usuario, nombre, telefono FROM usuarios WHERE nombre = ? AND telefono = ?';
        const [rows] = await pool.execute(query, [nombre, telefono]);

        if (rows.length === 0) {
            // No se encontró un usuario con esa combinación de credenciales
            return res.status(401).json({ error: 'Credenciales inválidas. Nombre o teléfono incorrectos.' });
        }

        // Si hay una coincidencia
        const user = rows[0];
        
        req.session.userId = user.id_usuario;
        req.session.userName = user.nombre;
        res.status(200).json({ success: true, message: 'Ingreso exitoso.', redirect: '/canastas.html' });
        
    } catch (error) {
        console.error('Error al ingresar usuario:', error);
        res.status(500).json({ error: 'Error interno del servidor al ingresar.' });
    }
});

// Ruta de Cierre de Sesión
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.redirect('/canastas.html'); 
        }
        res.clearCookie('connect.sid'); 
        res.redirect('/');
    });
});

// Ruta de Sesión (útil para que el frontend sepa si el usuario está logueado)
app.get('/session', (req, res) => {
    if (req.session.userId) {
        res.json({ loggedIn: true, userName: req.session.userName });
    } else {
        res.json({ loggedIn: false });
    }
});

// =======================================================
// 5. RUTAS DE VISTAS Y REDIRECCIONAMIENTO
// =======================================================

// Ruta Protegida: Solo accesible si está autenticado
app.get('/canastas.html', isAuthenticated, (req, res) => {
    res.sendFile(__dirname + '/public/canastas.html');
});

// Ruta Principal (Login/Registro)
app.get('/', (req, res) => {
    // Si ya está logueado, redirigir a la página de canastas
    if (req.session.userId) {
        return res.redirect('/canastas.html');
    }
    // Si no, mostrar la página de login/registro
    res.sendFile(__dirname + '/public/index.html');
});

// =======================================================
// 6. INICIO DEL SERVIDOR
// =======================================================
app.listen(port, () => {
    console.log(`Servidor iniciado en el puerto ${port}`);
});