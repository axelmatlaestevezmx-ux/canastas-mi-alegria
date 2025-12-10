// Archivo: public/js/carrito.js

let cart = []; // Almacena ítems del carrito (canastas predefinidas o canasta personalizada)
let personalizada = []; // Almacena los dulces seleccionados para la canasta personalizada
let totalPersonalizada = 0;

// --- Funciones para la Canasta Personalizada ---

function updatePersonalizadaDisplay() {
    const list = document.getElementById('personalizada-items');
    list.innerHTML = '';
    totalPersonalizada = 0;

    if (personalizada.length === 0) {
        list.innerHTML = '<li class="list-group-item text-muted">Aún no has añadido dulces.</li>';
        document.getElementById('btn-comprar-personalizada').disabled = true;
        document.getElementById('total-personalizada').textContent = '0.00';
        return;
    }

    // Calcular el total y mostrar los ítems
    personalizada.forEach(item => {
        totalPersonalizada += item.precio * item.cantidad;
        
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        listItem.innerHTML = `
            ${item.nombre} x ${item.cantidad} 
            <span>C$ ${(item.precio * item.cantidad).toFixed(2)} 
                <button class="btn btn-sm btn-danger ms-2" onclick="removeDulcePersonalizada(${item.id})">Quitar</button>
            </span>
        `;
        list.appendChild(listItem);
    });

    document.getElementById('total-personalizada').textContent = totalPersonalizada.toFixed(2);
    document.getElementById('btn-comprar-personalizada').disabled = false;
}

window.addDulceToPersonalizada = function(dulce) {
    const existing = personalizada.find(item => item.id === dulce.id);

    if (existing) {
        existing.cantidad++;
    } else {
        personalizada.push({ ...dulce, cantidad: 1 });
    }
    updatePersonalizadaDisplay();
}

window.removeDulcePersonalizada = function(id) {
    const index = personalizada.findIndex(item => item.id === id);
    if (index !== -1) {
        if (personalizada[index].cantidad > 1) {
            personalizada[index].cantidad--;
        } else {
            personalizada.splice(index, 1);
        }
    }
    updatePersonalizadaDisplay();
}

// --- Funciones para el Carrito de Compra (Final) ---

function updateCartDisplay() {
    const cartList = document.getElementById('cart-items');
    const finalTotalElement = document.getElementById('final-total');
    let finalTotal = 0;

    cartList.innerHTML = '';

    if (cart.length === 0) {
        cartList.innerHTML = '<li class="list-group-item text-muted">El carrito está vacío.</li>';
        document.getElementById('btn-checkout').disabled = true;
        finalTotalElement.textContent = '0.00';
        return;
    }

    cart.forEach((item, index) => {
        finalTotal += item.precio * item.cantidad;
        
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        listItem.innerHTML = `
            <strong>${item.nombre}</strong> (x${item.cantidad})
            <span>C$ ${(item.precio * item.cantidad).toFixed(2)} 
                <button class="btn btn-sm btn-danger ms-2" onclick="removeFromCart(${index})">Quitar</button>
            </span>
        `;
        cartList.appendChild(listItem);
    });
    
    finalTotalElement.textContent = finalTotal.toFixed(2);
    document.getElementById('btn-checkout').disabled = false;
}

window.addToCart = function(product) {
    const existing = cart.find(item => item.id === product.id && item.tipo === product.tipo);
    
    if (existing) {
        existing.cantidad++;
    } else {
        cart.push({ ...product, cantidad: 1 });
    }
    alert(`${product.nombre} añadido al carrito.`);
    updateCartDisplay();
}

window.removeFromCart = function(index) {
    cart.splice(index, 1);
    updateCartDisplay();
}

// Lógica para añadir la Canasta Personalizada al Carrito
document.getElementById('btn-comprar-personalizada').addEventListener('click', function() {
    if (personalizada.length === 0) {
        alert("La canasta personalizada está vacía.");
        return;
    }

    // Creamos un solo ítem para el carrito que representa la canasta personalizada
    const personalizedBasket = {
        id: Date.now(), // Usamos un ID temporal único para esta canasta personalizada
        nombre: 'Canasta Personalizada',
        precio: totalPersonalizada,
        tipo: 'Personalizada',
        cantidad: 1,
        // Almacenamos el detalle de los dulces para el checkout posterior
        detalle_dulces: personalizada 
    };

    cart.push(personalizedBasket);
    personalizada = []; // Limpiamos la canasta personalizada después de añadirla al carrito
    
    alert("Canasta Personalizada añadida al carrito.");
    updatePersonalizadaDisplay();
    updateCartDisplay();
});

// Inicializar la vista del carrito al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    updateCartDisplay();
    updatePersonalizadaDisplay();
});

// Enlazar el botón de checkout para el siguiente paso (Paso 5)
document.getElementById('btn-checkout').addEventListener('click', (e) => {
    e.preventDefault();
    if (cart.length === 0) {
        alert("El carrito está vacío.");
        return;
    }
    // Convertir el carrito a JSON y guardarlo en la sesión del navegador para el siguiente paso
    sessionStorage.setItem('currentCart', JSON.stringify(cart));
    // Redirigir a la página de pago
    window.location.href = '/checkout';
});