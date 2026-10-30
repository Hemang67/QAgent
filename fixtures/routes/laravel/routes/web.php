<?php
use App\Http\Controllers\OrderController;
use App\Http\Controllers\PhotoController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () { return view('welcome'); });
Route::view('/about', 'pages.about');
Route::get('/orders/{order}', [OrderController::class, 'show']);
Route::post('/orders', [OrderController::class, 'store']);
Route::match(['get', 'post'], '/contact', [OrderController::class, 'contact']);
// Route::get('/commented-out', ...);
Route::resource('photos', PhotoController::class)->only(['index', 'show']);
Route::prefix('admin')->group(function () {
    Route::get('/users', [OrderController::class, 'users']);
    Route::prefix('reports')->group(function () {
        Route::get('/sales/{year?}', [OrderController::class, 'sales']);
    });
});
Route::get('/after-groups', [OrderController::class, 'after']);
