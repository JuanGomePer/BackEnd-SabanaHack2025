import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

// Inicializa la base de datos con cumplimiento normativo
export async function initDB() {
  const db = await open({
    filename: './data.db',
    driver: sqlite3.Database
  });

  // ===== TABLA USUARIOS (mejorada con cumplimiento normativo) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      cedula TEXT PRIMARY KEY,
      tipo_documento TEXT NOT NULL DEFAULT 'CC',  -- CC, CE, TI, Pasaporte
      nombre TEXT NOT NULL,
      telefono TEXT,
      correo TEXT NOT NULL,
      codigo_qr TEXT UNIQUE,  -- QR único del usuario
      fecha_registro TEXT DEFAULT (datetime('now', 'localtime')),
      validacion_legal INTEGER DEFAULT 0,  -- 0=No validado, 1=Validado
      fecha_validacion_legal TEXT,
      terminos_aceptados INTEGER DEFAULT 0,  -- 0=No, 1=Sí
      fecha_aceptacion_terminos TEXT,
      estado TEXT DEFAULT 'ACTIVO'  -- ACTIVO, INACTIVO, BLOQUEADO
    );
  `);

  // Índices para búsqueda rápida
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_usuarios_qr ON usuarios(codigo_qr);
    CREATE INDEX IF NOT EXISTS idx_usuarios_correo ON usuarios(correo);
  `);

  // ===== TABLA PUNTOS DE VENTA (NUEVA) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS puntos_venta (
      id TEXT PRIMARY KEY,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      tipo_servicio TEXT NOT NULL,  -- CAFETERIA, RESTAURANTE, CATERING_INTERNO, CATERING_EXTERNO, VENDING
      ubicacion TEXT NOT NULL,  -- Campus Central, Clínica, INALDE, Calle 80
      estado TEXT DEFAULT 'ACTIVO',
      fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // Datos iniciales de puntos de venta (basados en la presentación)
  await db.exec(`
    INSERT OR IGNORE INTO puntos_venta (id, codigo, nombre, tipo_servicio, ubicacion) VALUES
    ('pv-1', 'PV-CC-01', 'Punto Café Zona Central', 'CAFETERIA', 'Campus Central'),
    ('pv-2', 'PV-CC-02', 'Punto Cipreses', 'CAFETERIA', 'Campus Central'),
    ('pv-3', 'PV-CC-03', 'Café de La Bolsa', 'CAFETERIA', 'Campus Central'),
    ('pv-4', 'PV-CC-04', 'Café y Letras', 'CAFETERIA', 'Campus Central'),
    ('pv-5', 'PV-CC-05', 'Restaurante Carta', 'RESTAURANTE', 'Campus Central'),
    ('pv-6', 'PV-CC-06', 'Restaurante a la Mesa', 'RESTAURANTE', 'Campus Central'),
    ('pv-7', 'PV-CC-07', 'Punto Wok', 'CAFETERIA', 'Campus Central'),
    ('pv-8', 'PV-CL-01', 'Clínica Unisabana', 'ESPECIALIZADO', 'Clínica Universidad'),
    ('pv-9', 'PV-IN-01', 'INALDE Eventos VIP', 'CATERING_INTERNO', 'INALDE'),
    ('pv-10', 'PV-C80-01', 'Cafetería Calle 80', 'CAFETERIA', 'Sede Calle 80'),
    ('pv-11', 'PV-VM-01', 'Máquinas Vending', 'VENDING', 'Campus Central');
  `);

  // ===== TABLA PRODUCTOS (NUEVA) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS productos (
      id TEXT PRIMARY KEY,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      categoria TEXT NOT NULL,  -- DESAYUNO, ALMUERZO, CENA, SNACK, BEBIDA, POSTRE
      precio REAL NOT NULL,
      disponible INTEGER DEFAULT 1,  -- 0=No disponible, 1=Disponible
      fecha_creacion TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_productos_codigo ON productos(codigo);
    CREATE INDEX IF NOT EXISTS idx_productos_categoria ON productos(categoria);
  `);

  // ===== TABLA ORDENES (mejorada con relación a punto de venta) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS ordenes (
      id TEXT PRIMARY KEY,
      numero INTEGER UNIQUE NOT NULL,  -- Consecutivo
      cedula TEXT NOT NULL,
      id_punto_venta TEXT NOT NULL,  -- Relación con punto de venta
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      subtotal REAL NOT NULL,
      impuestos REAL DEFAULT 0,
      total REAL NOT NULL,
      metodo_pago TEXT,  -- EFECTIVO, TARJETA, QR, TRANSFERENCIA
      metodo_validacion TEXT,  -- CEDULA, QR, CORREO
      estado TEXT DEFAULT 'COMPLETADA',  -- COMPLETADA, CANCELADA, PENDIENTE
      FOREIGN KEY(cedula) REFERENCES usuarios(cedula),
      FOREIGN KEY(id_punto_venta) REFERENCES puntos_venta(id)
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ordenes_cedula ON ordenes(cedula);
    CREATE INDEX IF NOT EXISTS idx_ordenes_fecha ON ordenes(fecha);
    CREATE INDEX IF NOT EXISTS idx_ordenes_punto_venta ON ordenes(id_punto_venta);
  `);

  // ===== TABLA DETALLE_ORDENES (NUEVA - desglose de productos) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS detalle_ordenes (
      id TEXT PRIMARY KEY,
      id_orden TEXT NOT NULL,
      id_producto TEXT NOT NULL,
      cantidad INTEGER NOT NULL,
      precio_unitario REAL NOT NULL,
      subtotal REAL NOT NULL,
      notas TEXT,
      FOREIGN KEY(id_orden) REFERENCES ordenes(id) ON DELETE CASCADE,
      FOREIGN KEY(id_producto) REFERENCES productos(id)
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_detalle_orden ON detalle_ordenes(id_orden);
    CREATE INDEX IF NOT EXISTS idx_detalle_producto ON detalle_ordenes(id_producto);
  `);

  // ===== TABLA DOCUMENTOS_EQUIVALENTES (NUEVA - Resolución 000165/2023) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS documentos_equivalentes (
      id TEXT PRIMARY KEY,
      id_orden TEXT UNIQUE NOT NULL,  -- Relación 1:1 con orden
      numero_documento TEXT UNIQUE NOT NULL,  -- Consecutivo legal
      tipo_documento TEXT DEFAULT 'DOCUMENTO_EQUIVALENTE',
      cufe TEXT UNIQUE,  -- Código Único de Factura Electrónica
      qr_documento TEXT,  -- QR para validación DIAN
      fecha_emision TEXT DEFAULT (datetime('now', 'localtime')),
      fecha_envio_correo TEXT,
      estado_envio TEXT DEFAULT 'PENDIENTE',  -- PENDIENTE, ENVIADO, ERROR
      intentos_envio INTEGER DEFAULT 0,
      url_documento TEXT,  -- Link al PDF/XML
      cumple_resolucion_000165 INTEGER DEFAULT 1,  -- 1=Cumple, 0=No cumple
      hash_documento TEXT,  -- Para verificar integridad
      FOREIGN KEY(id_orden) REFERENCES ordenes(id)
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_doc_equiv_orden ON documentos_equivalentes(id_orden);
    CREATE INDEX IF NOT EXISTS idx_doc_equiv_cufe ON documentos_equivalentes(cufe);
    CREATE INDEX IF NOT EXISTS idx_doc_equiv_fecha ON documentos_equivalentes(fecha_emision);
  `);

  // ===== TABLA FACTURAS (reemplazada por documentos_equivalentes, pero la mantenemos para compatibilidad) =====
  // Esta tabla ahora es redundante, pero la dejamos si ya tienes código que la usa
  await db.exec(`
    CREATE TABLE IF NOT EXISTS facturas (
      id TEXT PRIMARY KEY,
      numero TEXT UNIQUE NOT NULL,
      fecha TEXT DEFAULT (datetime('now', 'localtime')),
      cedula TEXT NOT NULL,
      id_orden TEXT,  -- Relación con orden
      total REAL NOT NULL,
      detalle TEXT,  -- JSON con detalle (legacy)
      -- Campos adicionales para cumplimiento
      cufe TEXT,
      qr_factura TEXT,
      estado_envio TEXT DEFAULT 'PENDIENTE',
      FOREIGN KEY(cedula) REFERENCES usuarios(cedula),
      FOREIGN KEY(id_orden) REFERENCES ordenes(id)
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_facturas_cedula ON facturas(cedula);
    CREATE INDEX IF NOT EXISTS idx_facturas_orden ON facturas(id_orden);
  `);

  // ===== TABLA VALIDACIONES_ACCESO (NUEVA - trazabilidad) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS validaciones_acceso (
      id TEXT PRIMARY KEY,
      cedula TEXT NOT NULL,
      metodo_validacion TEXT NOT NULL,  -- CEDULA, QR, CORREO
      fecha_hora TEXT DEFAULT (datetime('now', 'localtime')),
      id_punto_venta TEXT,
      exitosa INTEGER NOT NULL,  -- 0=Fallida, 1=Exitosa
      ip_validacion TEXT,
      mensaje_error TEXT,
      FOREIGN KEY(cedula) REFERENCES usuarios(cedula),
      FOREIGN KEY(id_punto_venta) REFERENCES puntos_venta(id)
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_validaciones_cedula ON validaciones_acceso(cedula);
    CREATE INDEX IF NOT EXISTS idx_validaciones_fecha ON validaciones_acceso(fecha_hora);
  `);

  // ===== TABLA AUDITORIA (NUEVA - registro de cambios) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS auditoria (
      id TEXT PRIMARY KEY,
      tabla TEXT NOT NULL,
      id_registro TEXT NOT NULL,
      accion TEXT NOT NULL,  -- INSERT, UPDATE, DELETE
      usuario TEXT,  -- Usuario del sistema que hizo el cambio
      cedula_relacionada TEXT,  -- Usuario afectado (si aplica)
      fecha_hora TEXT DEFAULT (datetime('now', 'localtime')),
      datos_anteriores TEXT,  -- JSON con datos antes del cambio
      datos_nuevos TEXT,  -- JSON con datos después del cambio
      ip_origen TEXT
    );
  `);

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auditoria_tabla ON auditoria(tabla);
    CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha_hora);
    CREATE INDEX IF NOT EXISTS idx_auditoria_cedula ON auditoria(cedula_relacionada);
  `);

  // ===== TABLA CONFIGURACION_NORMATIVA (NUEVA - parámetros legales) =====
  await db.exec(`
    CREATE TABLE IF NOT EXISTS configuracion_normativa (
      id TEXT PRIMARY KEY,
      parametro TEXT UNIQUE NOT NULL,
      valor TEXT NOT NULL,
      descripcion TEXT,
      resolucion_aplicable TEXT,  -- ej: "000165 de 2023"
      fecha_vigencia TEXT,
      activo INTEGER DEFAULT 1,
      fecha_actualizacion TEXT DEFAULT (datetime('now', 'localtime'))
    );
  `);

  // Insertar configuraciones iniciales
  await db.exec(`
    INSERT OR IGNORE INTO configuracion_normativa (id, parametro, valor, descripcion, resolucion_aplicable) VALUES
    ('conf-1', 'RESOLUCION_VIGENTE', '000165', 'Resolución DIAN para documentos equivalentes', '000165 de 2023'),
    ('conf-2', 'FECHA_RESOLUCION', '2023-11-01', 'Fecha de vigencia de la resolución', '000165 de 2023'),
    ('conf-3', 'PREFIJO_FACTURA', 'UDINING', 'Prefijo para numeración de facturas', '000165 de 2023'),
    ('conf-4', 'LOGO_EMPRESA', '/assets/logo-unisabana-dining.png', 'Logo para documentos', 'N/A'),
    ('conf-5', 'NIT_EMPRESA', '860012357-6', 'NIT Universidad de La Sabana', 'N/A');
  `);

  console.log('✅ Base de datos inicializada con cumplimiento normativo');
  console.log('📋 Tablas creadas:');
  console.log('   - usuarios (con validación legal y términos)');
  console.log('   - puntos_venta (11 puntos inicializados)');
  console.log('   - productos');
  console.log('   - ordenes (con relación a punto de venta)');
  console.log('   - detalle_ordenes (desglose de productos)');
  console.log('   - documentos_equivalentes (Resolución 000165/2023)');
  console.log('   - facturas (legacy, compatible)');
  console.log('   - validaciones_acceso (trazabilidad)');
  console.log('   - auditoria');
  console.log('   - configuracion_normativa');

  return db;
}

// ===== FUNCIONES AUXILIARES PARA USO COMÚN =====

// Generar código QR único para usuario
export function generarCodigoQR(cedula) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return 'UDINING:${cedula}:${timestamp}:${random}';
}

// Generar CUFE (Código Único de Factura Electrónica)
export async function generarCUFE(numeroDocumento, fecha, total, nitEmpresa) {
  const { createHash } = await import('crypto');
  const data = `${numeroDocumento}${fecha}${total}${nitEmpresa}`;
  return createHash('sha256').update(data).digest('hex').toUpperCase();
}

// Generar número de documento consecutivo
export async function obtenerConsecutivoDocumento(db, prefijo = 'UDINING') {
  const fecha = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const ultimoDoc = await db.get(`
    SELECT numero_documento 
    FROM documentos_equivalentes 
    WHERE numero_documento LIKE '${prefijo}-${fecha}%'
    ORDER BY numero_documento DESC 
    LIMIT 1
  `);
  
  let consecutivo = 1;
  if (ultimoDoc) {
    const partes = ultimoDoc.numero_documento.split('-');
    consecutivo = parseInt(partes[partes.length - 1]) + 1;
  }
  
  return `${prefijo}-${fecha}-${consecutivo.toString().padStart(6, '0')}`;
}

// Registrar en auditoría
export async function registrarAuditoria(db, tabla, idRegistro, accion, datosAnteriores, datosNuevos, usuario = 'SISTEMA', cedula = null, ip = null) {
  const { v4: uuidv4 } = await import('uuid');
  await db.run(`
    INSERT INTO auditoria (
      id, tabla, id_registro, accion, usuario, cedula_relacionada,
      datos_anteriores, datos_nuevos, ip_origen
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    uuidv4(),
    tabla,
    idRegistro,
    accion,
    usuario,
    cedula,
    JSON.stringify(datosAnteriores),
    JSON.stringify(datosNuevos),
    ip
  ]);
}