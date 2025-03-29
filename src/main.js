const { app, BrowserWindow, powerSaveBlocker, ipcMain } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');


// Path to the SQLite database file
const dbPath = path.join(__dirname, 'workout.db');
const db = new Database(dbPath);

let mainWindow; // This will hold the window object to prevent it from being garbage collected

// Function to create and return a new browser window
function createWindow(filename, options) {
    const win = new BrowserWindow({
        width: options.width || 1280,
        height: options.height || 720,
        webPreferences: {
            nodeIntegration: true, // For simplicity in this example; consider security implications
            contextIsolation: false // Same as above, for production consider using context isolation and preload scripts
        }
    });

    // Load the HTML file into the window
    win.loadFile(path.join(__dirname, filename));

    // Open DevTools if devTools option is true
    if (options.devTools) {
        win.webContents.openDevTools();
    }

    return win;
}

// App lifecycle 'ready' event
app.on('ready', () => {
    // Create the main window with development tools opened
    const powerSaveId = powerSaveBlocker.start('prevent-display-sleep');
    mainWindow = createWindow('index.html', { devTools: false });
});

// Quit the app when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// On macOS, re-create the window if the app is activated and there are no other windows open
app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow('index.html', { devTools: false });
    }
});

// Function to open different screens within the application
function openScreen(screenName) {
    const screenPaths = {
        welcome: './src/index.html',
        edit: './src/edit.html',
        exercise: './src/exercise.html',
        stats: './src/stats.html',
        setttings: '.src/settings.html'
    };

    if (mainWindow) {
        mainWindow.loadFile(screenPaths[screenName])
        .catch(err => console.error('Failed to load page:', err));
    } else {
        // mainWindow doesn't exist, so create it
        const options = { width: 1280, height: 720, devTools: true };
        mainWindow = createWindow(screenPaths[screenName], options);
    }
}

// IPC listener for opening different screens
ipcMain.on('open-screen', (event, screenName) => {
    openScreen(screenName);
});

// IPC listener for adding an exercise
ipcMain.on('add-exercise', (event, exerciseData) => {
    const { name, imagePath, reps, sets, weight, restTime } = exerciseData;
    try {
        addExercise(name, imagePath, reps, sets, weight, restTime);
        event.reply('exercise-added', 'Exercise added successfully!');
        // Refresh the exercise table
        event.sender.send('refresh-exercise-table');
    } catch (error) {
        console.error('Error adding exercise:', error.message);
        event.reply('exercise-added', `Error adding exercise: ${error.message}`);
    }
});

// Function to update exercise
const updateExercise = (id, updates) => {
    try {
        // Build the SQL query dynamically based on which fields are provided
        let sql = `UPDATE exercises SET `;
        let params = [];
        
        for (const [field, value] of Object.entries(updates)) {
            sql += `${field} = ?, `;
            params.push(value);
        }

        // Remove trailing comma and add the WHERE clause
        sql = sql.slice(0, -2); // Remove trailing comma
        sql += ` WHERE id = ?`;
        params.push(id);

        const stmt = db.prepare(sql);
        stmt.run(params);
    } catch (error) {
        console.error('Error updating exercise:', error.message);
        throw error; // Propagate the error to be caught by the IPC handler
    }
};
// IPC listener for updating planner db when exercises are dragged
ipcMain.handle('update-planner-db', async (event, day, exercises) => {
    const stmt = db.prepare(`UPDATE planner SET exercises = ? WHERE day = ?`);
    stmt.run(exercises, day); 
});

// IPC listener for updating an exercise
ipcMain.handle('update-exercise', async (event, updatedExercise) => {
    const { id, ...fieldsToUpdate } = updatedExercise;
    try {
        updateExercise(id, fieldsToUpdate);
        event.sender.send('refresh-exercise-table');
    } catch (error) {
        console.error('Error updating exercise:', error.message);
    }
});

// IPC listener for deleting an exercise
ipcMain.on('delete-exercise', (event, id) => {
    try {
        deleteExercise(id);
        event.reply('exercise-deleted', 'Exercise deleted successfully!');
        // Notify renderer to refresh the exercise table
        event.sender.send('refresh-exercise-table');
    } catch (error) {
        console.error('Error deleting exercise:', error.message);
        event.reply('exercise-deleted', `Error deleting exercise: ${error.message}`);
    }
});

// IPC listener for getting exercises
ipcMain.handle('get-exercises', () => {
    try {
        const stmt = db.prepare('SELECT * FROM exercises');
        return stmt.all();
    } catch (error) {
        console.error('Error fetching exercises:', error.message);
        return [];
    }
});
ipcMain.handle('get-planner-db', (event, day) => {
    try {
        // Safely prepare and execute the query to get exercises for the selected day
        const stmt = db.prepare(`SELECT exercises FROM planner WHERE day = ?`);
        const result = stmt.get(day); // Fetch a single record
        
        // Return the exercises if found, or an empty string otherwise
        return result?.exercises || ''; 
    } catch (error) {
        console.error('Error fetching exercises:', error.message);
        return ''; 
    }
});

// Get exercise from by providing id
ipcMain.handle('get-planner-table-exercise-name', async (event, exerciseId) => {
    const exerciseNameQuery = db.prepare(`SELECT * FROM exercises WHERE id = ?`);
    const result = exerciseNameQuery.get(exerciseId); 
    return result; 

}); 

// Function to add a new exercise
function addExercise(name, imagePath, reps, sets, weight, restTime) {
    try {
        const stmt = db.prepare(`
            INSERT INTO exercises (name, image_path, default_reps, default_sets, default_weight, default_rest_time)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(name, imagePath, reps, sets, weight, restTime);
    } catch (error) {
        console.error('Error adding exercise:', error.message);
        throw error; // Propagate the error to be caught by the IPC handler
    }
}

// Function to delete an exercise
function deleteExercise(id) {
    try {
        const stmt = db.prepare(`DELETE FROM exercises WHERE id = ?`);
        stmt.run(id);
    } catch (error) {
        console.error('Error deleting exercise:', error.message);
        throw error; // Propagate the error to be caught by the IPC handler
    }
}

let currentDay = '';
ipcMain.on('set-current-day', (event, value) => {
    currentDay = value;
});
ipcMain.handle('get-current-day', async () => {
    return currentDay;
});
ipcMain.handle('get-planner-ids', async () => {
    const exerciseIdsQuery = db.prepare(`SELECT exercises FROM planner WHERE day = ?`);
    const result = exerciseIdsQuery.get(currentDay);
    if (result.exercises) {
        return result.exercises;
    } else {
        return "Rest";
    }
});

