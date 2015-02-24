<?php
/**
 * DevPanel Configuration Model
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */

class ManneBusk_DevPanel_Model_Config extends Varien_Object
{
    /**
     * Load configuration
     * 
     * @access protected
     * @return $this
     */
    protected function _construct()
    {
        $configFile = Mage::getModuleDir('etc', 'ManneBusk_DevPanel') . DS . 'local.php';
        if (file_exists($configFile)) {
            include $configFile;
        }

        if (isset($config)) {
            $this->_data = new Varien_Object($config);
        }
    }

    /**
     * Get configuration (alias for getData)
     * 
     * @param string $path 
     *
     * @return mixed
     */
    public function getConfig($path = "")
    {
        return $this->getData($path);
    }
}
