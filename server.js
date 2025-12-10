// Cargar variables de entorno (para Render)
require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session'); 
const PDFDocument = require('pdfkit'); 
const MySQLStore = require('express-mysql-session')(session);

const app = express();
// Usa el puerto de entorno proporcionado por Render o 3000 por defecto
const port = process.env.PORT || 3000; 
const saltRounds = 10; 

// --- Configuración de la Base de Datos TiDB Cloud (CON SSL) ---
const DB_CONFIG_TIDB = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 4000, // TiDB Serverless usa 4000
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // *** CONFIGURACIÓN CRÍTICA PARA TI DB CLOUD ***
    ssl: { 
        // Permite la conexión sin necesidad de descargar el archivo .pem
        // Ya que el firewall está abierto, esto DEBE funcionar.
        rejectUnauthorized: false 
    } 
};

let pool;
try {
    pool = mysql.createPool(DB_CONFIG_TIDB);
    console.log("Conexión a la base de datos TiDB establecida correctamente.");
} catch (error) {
    console.error("Error al conectar a la base de datos:", error.message);
    process.exit(1); 
}

// --- Configuración del Almacén de Sesiones en MySQL (TiDB) ---
// La configuración del store también DEBE usar la conexión SSL.
const sessionStore = new MySQLStore({
    ...DB_CONFIG_TIDB, // Reutiliza la configuración completa, incluyendo SSL
    clearExpired: true,
    checkExpirationInterval: 900000, 
    expiration: 86400000, 
    endConnectionOnClose: true 
}, pool);


// --- Middlewares y Configuración ---
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public'))); 

// Configuración de Express-Session
app.use(session({
    secret: process.env.SESSION_SECRET || 'CLAVE_SECRETA_POR_DEFECTO', 
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24,
        // secure: true es recomendable en Render si usas HTTPS, pero false funciona con HTTP.
        secure: process.env.NODE_ENV === 'production', 
        httpOnly: true 
    } 
}));

// ----------------------------------------------------
// MIDDLEWARE DE AUTENTICACIÓN Y RUTAS PRINCIPALES
// ----------------------------------------------------

function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        return next();
    } else {
        res.redirect('/login.html');
    }
}

// RUTA RAÍZ CORREGIDA
app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/inicio');
    }
    res.redirect('/login.html'); 
});

// RUTAS DE REGISTRO
app.get('/register', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'register.html')); });
app.post('/register', async (req, res) => {
    const { nombre, email, telefono } = req.body; 
    try {
        const hashedPassword = await bcrypt.hash(telefono, saltRounds);
        await pool.execute(`INSERT INTO usuarios (nombre, email, telefono, fecha_registro) VALUES (?, ?, ?, NOW())`, [nombre, email, hashedPassword]);
        res.status(201).send(`<script>alert('¡Registro exitoso! Ya puedes iniciar sesión.'); window.location.href = '/login.html';</script>`);
    } catch (error) {
        console.error("FALLO DE REGISTRO:", error); 
        // 1062 es código de duplicado en MySQL (nombre y teléfono únicos)
        if (error.code === 'ER_DUP_ENTRY') {
             return res.status(409).send(`<script>alert('Ya existe un usuario con ese nombre y/o teléfono.'); window.location.href = '/register';</script>`);
        }
        res.status(500).send("Error interno del servidor al registrar usuario.");
    }
});

// RUTAS DE LOGIN
app.get('/login', (req, res) => { 
    if (req.session && req.session.userId) return res.redirect('/inicio'); 
    res.redirect('/login.html'); 
}); 

app.post('/login', async (req, res) => {
    const { nombre, telefono } = req.body; 
    try {
        const [rows] = await pool.execute(`SELECT id_usuario, telefono FROM usuarios WHERE nombre = ?`, [nombre]);
        
        if (rows.length === 0) return res.status(401).send("Nombre de usuario o clave incorrectos.");
        
        const match = await bcrypt.compare(telefono, rows[0].telefono);
        
        if (match) {
            req.session.userId = rows[0].id_usuario; 
            res.redirect('/inicio'); 
        } else {
            res.status(401).send("Nombre de usuario o clave incorrectos.");
        }
    } catch (error) {
        console.error("FALLO DE AUTENTICACION O CONSULTA:", error); 
        res.status(500).send("Error interno del servidor al iniciar sesión.");
    }
});

// RUTA DE LOGOUT
app.get('/logout', (req, res) => { 
    req.session.destroy(err => { 
        if (err) {
            console.error("Error al cerrar sesión:", err);
            return res.status(500).send("No se pudo cerrar la sesión.");
        }
        res.redirect('/login.html'); 
    }); 
});
// ----------------------------------------------------
// RUTAS DE COMPRA (INICIO / CONFIGURACIÓN)
// ----------------------------------------------------

// RUTA DE SELECCIÓN DE PRODUCTOS (/inicio)
app.get('/inicio', requireAuth, async (req, res) => {
    try {
        const [canastas] = await pool.execute(`
            SELECT id_canasta, nombre, descripcion, precio_base, tamano 
            FROM canastas 
            WHERE activa = 1
        `);

        let canastasHTML = '';
        canastas.forEach(canasta => {
            const precioFormateado = parseFloat(canasta.precio_base).toFixed(2);
            
            canastasHTML += `
                <div class="col-md-4 mb-4">
                    <div class="card h-100">
                        <div class="card-body d-flex flex-column">
                            <h5 class="card-title">${canasta.nombre} (${canasta.tamano})</h5>
                            <p class="card-text">${canasta.descripcion}</p>
                            <h4 class="mt-auto">MX$ ${precioFormateado}</h4>
                            <a href="/configurar-canasta/${canasta.id_canasta}" class="btn btn-primary mt-2">
                                Configurar y Comprar
                            </a>
                        </div>
                    </div>
                </div>
            `;
        });

        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Selección de Canastas | Canastas Mi Alegría</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=swap" rel="stylesheet">
                <link href="/style.css" rel="stylesheet">
            </head>
            <body>
                <header class="main-header mb-5 d-flex justify-content-between align-items-center p-3">
                    <h1>Canastas Mi Alegría 🍬</h1>
                    <div>
                        <a href="/logout" class="btn btn-logout btn-sm">
                            Cerrar Sesión (Salir)
                        </a>
                    </div>
                </header>

                <div class="container">
                    <h2 class="mt-5">🎁 Canastas Predefinidas</h2>
                    <div class="row">
                        ${canastasHTML.length > 0 ? canastasHTML : '<p class="alert alert-info">No hay canastas predefinidas activas.</p>'}
                    </div>
                    
                    <hr class="my-5">

                    <h2 class="mb-4">🛒 Carrito de Pedido</h2>
                    <div id="cart-summary" class="card p-3">
                        <p>Los ítems añadidos aparecerán en el carrito del navegador. Finaliza tu compra aquí:</p>
                        <div class="text-end">
                            <a href="/checkout" id="btn-checkout" class="btn btn-warning btn-lg mt-3">
                                Proceder al Pago (Checkout)
                            </a>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `);

    } catch (error) {
        console.error("Error al cargar la página de inicio/productos:", error.message);
        res.status(500).send("Error interno del servidor al obtener los productos.");
    }
});

// RUTA DE CONFIGURACIÓN DE CANASTA
app.get('/configurar-canasta/:id', requireAuth, async (req, res) => {
    const canastaId = req.params.id;

    try {
        const [canastaRows] = await pool.execute(`SELECT id_canasta, nombre, descripcion, precio_base, limite_personalizacion FROM canastas WHERE id_canasta = ?`, [canastaId]);
        if (canastaRows.length === 0) return res.status(404).send("Canasta no encontrada.");
        const canasta = canastaRows[0];
        canasta.precio_base = parseFloat(canasta.precio_base);

        const [dulcesPredefinidos] = await pool.execute(`
            SELECT d.id_dulce, d.nombre, d.precio_unitario, cd.cantidad
            FROM canasta_detalle cd JOIN dulces d ON cd.id_dulce = d.id_dulce WHERE cd.id_canasta = ?
        `, [canastaId]);

        const [dulcesDisponibles] = await pool.execute(`SELECT id_dulce, nombre, precio_unitario, tipo FROM dulces WHERE activo = 1 AND stock > 0`);

        let predefinidosHTML = '';
        dulcesPredefinidos.forEach(dulce => {
            const precioTotal = parseFloat(dulce.precio_unitario) * dulce.cantidad;
            predefinidosHTML += `<li class="list-group-item d-flex justify-content-between align-items-center bg-light">${dulce.nombre} (x${dulce.cantidad})<span>MX$ ${precioTotal.toFixed(2)}</span></li>`;
        });
        
        let disponiblesHTML = '';
        dulcesDisponibles.forEach(dulce => {
            const precioFormateado = parseFloat(dulce.precio_unitario).toFixed(2);
            disponiblesHTML += `
                <li class="list-group-item d-flex justify-content-between align-items-center">
                    ${dulce.nombre} (${dulce.tipo})
                    <span>MX$ ${precioFormateado}
                        <button class="btn btn-sm btn-primary ms-3" 
                            onclick="addPersonalizado({id: ${dulce.id_dulce}, nombre: '${dulce.nombre}', precio: ${dulce.precio_unitario}})">
                            Añadir
                        </button>
                    </span>
                </li>
            `;
        });

        res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Configurar ${canasta.nombre} | Canastas Mi Alegría</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
                <link href="/style.css" rel="stylesheet">
            </head>
            <body>
                <header class="main-header mb-5 d-flex justify-content-between align-items-center p-3">
                    <h1>Canastas Mi Alegría 🍬</h1>
                    <div>
                        <a href="/logout" class="btn btn-logout btn-sm">
                            Cerrar Sesión (Salir)
                        </a>
                    </div>
                </header>

                <div class="container my-5">
                    <a href="/inicio" class="btn btn-secondary mb-3">← Volver a Canastas</a>
                    <h1>🧺 Configurando: ${canasta.nombre}</h1>
                    <p class="lead">${canasta.descripcion}</p>

                    <div class="row">
                        <div class="col-md-5">
                            <div class="card p-4">
                                <h4>Contenido Base</h4>
                                <ul class="list-group mb-3">${predefinidosHTML}</ul>
                                
                                <h4>Tu Personalización</h4>
                                <ul class="list-group mb-3" id="personalizada-items">
                                    <li class="list-group-item text-muted">Añade hasta ${canasta.limite_personalizacion} dulces extra.</li>
                                </ul>
                                
                                <div class="alert alert-info">
                                    Límite de dulces extra: <strong id="limite-actual">${canasta.limite_personalizacion}</strong> restantes.
                                </div>

                                <div class="mt-4 text-end">
                                    <h5>Subtotal Base: MX$ ${canasta.precio_base.toFixed(2)}</h5>
                                    <h5>Costo Personalización: MX$ <span id="total-personalizacion">0.00</span></h5>
                                    <h3 class="mt-3">TOTAL: MX$ <span id="total-final">${canasta.precio_base.toFixed(2)}</span></h3>
                                    
                                    <button class="btn btn-lg btn-success w-100 mt-3" onclick="confirmarConfiguracion()">
                                        Confirmar y Añadir al Carrito
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="col-md-7">
                            <h4>Dulces Disponibles para Añadir</h4>
                            <ul class="list-group">${disponiblesHTML}</ul>
                        </div>
                    </div>
                </div>

                <script>
                    const CANASTA_ID = ${canasta.id_canasta};
                    const CANASTA_NOMBRE = "${canasta.nombre}";
                    const PRECIO_BASE = ${canasta.precio_base};
                    const LIMITE_MAXIMO = ${canasta.limite_personalizacion};
                    let dulcesPersonalizados = [];
                    let dulcesActuales = 0;

                    function updateDisplay() {
                        const list = document.getElementById('personalizada-items');
                        list.innerHTML = '';
                        let costoPersonalizacion = 0;
                        dulcesActuales = 0;

                        if (dulcesPersonalizados.length === 0) {
                            list.innerHTML = '<li class="list-group-item text-muted">Añade hasta ' + LIMITE_MAXIMO + ' dulces extra.</li>';
                        }

                        dulcesPersonalizados.forEach((item, index) => {
                            const itemPrice = parseFloat(item.precio); 
                            costoPersonalizacion += itemPrice * item.cantidad;
                            dulcesActuales += item.cantidad;

                            const listItem = document.createElement('li');
                            listItem.className = 'list-group-item d-flex justify-content-between align-items-center list-pastel-item';
                            listItem.innerHTML = \`
                                \${item.nombre} (x\${item.cantidad})
                                <span>MX$ \${(itemPrice * item.cantidad).toFixed(2)} 
                                    <button class="btn btn-sm btn-danger ms-2" onclick="removePersonalizado(\${index})">Quitar</button>
                                </span>
                            \`;
                            list.appendChild(listItem);
                        });

                        const restantes = LIMITE_MAXIMO - dulcesActuales;
                        document.getElementById('limite-actual').textContent = restantes >= 0 ? restantes : '¡LÍMITE EXCEDIDO!';
                        document.getElementById('total-personalizacion').textContent = costoPersonalizacion.toFixed(2);
                        
                        const totalFinal = PRECIO_BASE + costoPersonalizacion;
                        document.getElementById('total-final').textContent = totalFinal.toFixed(2);
                        
                        const btns = document.querySelectorAll('.btn-primary.ms-3');
                        btns.forEach(btn => {
                            btn.disabled = restantes <= 0;
                        });

                        document.querySelector('.btn-lg.btn-success').disabled = restantes < 0;
                    }

                    window.addPersonalizado = function(dulce) {
                        if (dulcesActuales >= LIMITE_MAXIMO) {
                            alert(\`¡Atención! Has alcanzado el límite máximo de \${LIMITE_MAXIMO} dulces extras para esta canasta.\`);
                            return;
                        }
                        
                        const existing = dulcesPersonalizados.find(item => item.id === dulce.id);
                        if (existing) {
                            existing.cantidad++;
                        } else {
                            dulcesPersonalizados.push({ ...dulce, precio: parseFloat(dulce.precio), cantidad: 1 });
                        }
                        updateDisplay();
                    }

                    window.removePersonalizado = function(index) {
                        if (dulcesPersonalizados[index].cantidad > 1) {
                            dulcesPersonalizados[index].cantidad--;
                        } else {
                            dulcesPersonalizados.splice(index, 1);
                        }
                        updateDisplay();
                    }
                    
                    window.confirmarConfiguracion = function() {
                        if (dulcesActuales > LIMITE_MAXIMO) {
                            alert("No puedes confirmar si has excedido el límite.");
                            return;
                        }
                        
                        let costoPersonalizacion = 0;
                        dulcesPersonalizados.forEach(d => { costoPersonalizacion += d.precio * d.cantidad; });
                        const totalFinal = PRECIO_BASE + costoPersonalizacion;

                        const canastaFinal = {
                            id_canasta_original: CANASTA_ID, 
                            nombre: CANASTA_NOMBRE,
                            precio_base: PRECIO_BASE,
                            costo_extra: costoPersonalizacion,
                            precio_final: totalFinal,
                            detalle_personalizado: dulcesPersonalizados, 
                            tipo: 'Canasta_Configurada',
                            cantidad: 1 
                        };

                        let cart = JSON.parse(sessionStorage.getItem('currentCart') || '[]');
                        cart.push({ ...canastaFinal, id: Date.now() });
                        sessionStorage.setItem('currentCart', JSON.stringify(cart));
                        
                        alert("Canasta configurada y añadida al carrito. Procediendo al Checkout.");
                        window.location.href = '/checkout';
                    }

                    document.addEventListener('DOMContentLoaded', updateDisplay);
                </script>
            </body>
            </html>
        `);
    } catch (error) {
        console.error("Error al configurar canasta:", error.message);
        res.status(500).send("Error interno al cargar la configuración de la canasta.");
    }
});
// ----------------------------------------------------
// RUTAS DE PAGO Y PEDIDO
// ----------------------------------------------------

app.get('/checkout', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'checkout.html')); });

app.get('/resumen', requireAuth, (req, res) => { res.sendFile(path.join(__dirname, 'public', 'resumen.html')); });

app.get('/ticket-pdf/:id', requireAuth, async (req, res) => {
    const pedidoId = req.params.id;
    const userId = req.session.userId;
    let connection;
    try {
        connection = await pool.getConnection();
        const [pedidoRows] = await connection.execute(
            `SELECT p.total, p.fecha_pedido, p.direccion_entrega, p.mensaje_tarjeta, tp.nombre as metodo_pago
             FROM pedidos p JOIN tipo_pago tp ON p.id_tipo_pago = tp.id_tipo_pago
             WHERE p.id_pedido = ? AND p.id_usuario = ?`, [pedidoId, userId]
        );
        if (pedidoRows.length === 0) return res.status(404).send("Pedido no encontrado o no autorizado.");
        const pedido = pedidoRows[0];
        const [items] = await connection.execute(
            `SELECT nombre_producto, cantidad, precio_unitario FROM pedido_items WHERE id_pedido = ?`, [pedidoId]
        );
        connection.release(); 

        const doc = new PDFDocument();
        const filename = `ticket_pedido_${pedidoId}.pdf`;
        res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-type', 'application/pdf');
        doc.pipe(res);

        // Contenido del Ticket
        doc.fontSize(25).text('TICKET DE COMPRA | Canastas Mi Alegría', { align: 'center' }).moveDown(1);
        doc.fontSize(12).text(`Pedido N°: ${pedidoId}`, { continued: true })
            .text(`Fecha: ${new Date(pedido.fecha_pedido).toLocaleDateString()}`, { align: 'right' }).moveDown(0.5);
        doc.text(`Dirección de Entrega: ${pedido.direccion_entrega}`).moveDown(0.5);
        doc.text(`Método de Pago: ${pedido.metodo_pago}`).moveDown(1);
        doc.fontSize(16).text('Detalle de Artículos:', { underline: true }).moveDown(0.5);

        let y = doc.y;
        doc.fontSize(10).text('Producto', 50, y, { width: 300 })
            .text('Cant.', 350, y, { width: 50 })
            .text('P. Unitario', 400, y, { width: 80 })
            .text('Subtotal', 480, y, { width: 80, align: 'right' });
        doc.moveDown(0.5);
        doc.strokeColor('#aaaaaa').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke().moveDown(0.2);
        
        items.forEach(item => {
            const subtotal = item.cantidad * parseFloat(item.precio_unitario);
            doc.text(`${item.nombre_producto}`, 50, doc.y, { width: 300, continued: true })
               .text(`${item.cantidad}`, 350, doc.y, { width: 50, continued: true })
               .text(`MX$ ${parseFloat(item.precio_unitario).toFixed(2)}`, 400, doc.y, { width: 80, continued: true })
               .text(`MX$ ${subtotal.toFixed(2)}`, 480, doc.y, { width: 80, align: 'right' });
            doc.moveDown(0.5);
        });

        doc.moveDown(1);
        doc.fontSize(12).text('-------------------------------------------------------------------------------------------------------------');
        doc.fontSize(14).text(`TOTAL PAGADO: MX$ ${parseFloat(pedido.total).toFixed(2)}`, 50, doc.y, { align: 'right' }).moveDown(1);
        if (pedido.mensaje_tarjeta) {
            doc.fontSize(12).text('Mensaje de Regalo:', 50, doc.y).moveDown(0.5);
            doc.fontSize(10).text(`"${pedido.mensaje_tarjeta}"`).moveDown(1);
        }
        doc.fontSize(10).text('¡Gracias por tu compra!', { align: 'center' });
        doc.end();

    } catch (error) {
        if (connection) connection.release();
        console.error("Error al generar el PDF del ticket:", error.message);
        res.status(500).send("Error interno del servidor al generar el ticket.");
    }
});


// RUTA POST PARA FINALIZAR PEDIDO (Guarda la transacción en la BD)
app.post('/finalizar-pedido', requireAuth, async (req, res) => {
    const { total, id_tipo_pago, items, mensaje_tarjeta, direccion_entrega } = req.body;
    const userId = req.session.userId;
    if (!total || !id_tipo_pago || !items || items.length === 0 || !direccion_entrega) {
        return res.status(400).send("Datos de pedido incompletos.");
    }
    
    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [pedidoResult] = await connection.execute(
            `INSERT INTO pedidos (id_usuario, total, id_tipo_pago, estado, mensaje_tarjeta, direccion_entrega) 
             VALUES (?, ?, ?, 'pendiente', ?, ?)`,
            [userId, total, id_tipo_pago, mensaje_tarjeta || '', direccion_entrega]
        );
        const pedidoId = pedidoResult.insertId;

        for (const item of items) {
            const precioUnitario = item.precio_final || item.precio; 
            if (item.tipo === 'Canasta_Configurada') {
                await connection.execute(
                    `INSERT INTO pedido_items (id_pedido, tipo_producto, id_producto, nombre_producto, cantidad, precio_unitario) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [pedidoId, 'Canasta', item.id_canasta_original, item.nombre, item.cantidad, precioUnitario]
                );
                if (item.detalle_personalizado && item.detalle_personalizado.length > 0) {
                    for(const dulceExtra of item.detalle_personalizado) {
                         await connection.execute(
                            `INSERT INTO pedido_items (id_pedido, tipo_producto, id_producto, nombre_producto, cantidad, precio_unitario) 
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [pedidoId, 'Dulce', dulceExtra.id, `Extra: ${dulceExtra.nombre}`, dulceExtra.cantidad, dulceExtra.precio]
                        );
                    }
                }
            } 
        }

        await connection.commit(); 
        
        res.status(200).json({ 
            success: true, 
            message: "Pedido procesado con éxito.",
            pedidoId: pedidoId,
            redirectUrl: `/ticket-pdf/${pedidoId}`,
            redirectBack: '/inicio'
        });

    } catch (error) {
        if (connection) await connection.rollback(); 
        console.error("Error al finalizar el pedido y guardar en BD:", error.message);
        res.status(500).json({ success: false, message: "Error al procesar el pedido." });
    } finally {
        if (connection) connection.release();
    }
});


// ----------------------------------------------------
// INICIO DEL SERVIDOR 
// ----------------------------------------------------
app.listen(port, () => {
    console.log(`Servidor de Canastas de Dulces corriendo en el puerto ${port}`);
});