<?php
/**
 * DevPanel Observer
 *
 * @package ManneBusk_DevPanel
 * @module  ManneBusk
 * @author  ManneBusk <mannebusk@gmail.com>
 */
class ManneBusk_DevPanel_Model_Observer
{
    /**
     * Add devpanel layout handle on all requests
     *
     * @param   Varien_Event_Observer $observer
     */
    public function addLayoutHandle(Varien_Event_Observer $observer)
    {
        $observer->getEvent()
            ->getLayout()
            ->getUpdate()
            ->addHandle('devpanel');
    }

    /**
     * Add comments around all blocks to create block hints.
     *
     * @param   Varien_Event_Observer $observer
     */
    public function addBlockHints(Varien_Event_Observer $observer)
    {
        $block  = $observer->getBlock();
        if ($block instanceof Mage_Core_Block_Template) {
            $html   = $observer->getTransport()->getHtml();
            $startComment = "\n<!-- block:{$block->getNameInLayout()} -->\n";
            $endComment = "\n<!-- #block:{$block->getNameInLayout()} -->\n";
            $observer->getTransport()->setHtml($startComment . $html . $endComment);
        }
    }

    /**
     * Automatially turn on "enable symlinks" on page load
     *
     */
    public function setEnableSymlinks()
    {
        $config = Mage::getModel('core/config');
        $allowSymlinks = Mage::getStoreConfigFlag('dev/template/allow_symlink');

        if (!$allowSymlinks) {
            $config->saveConfig('dev/template/allow_symlink', true);
        }
    }

    /**
     * Login to admin by only posting username
     *
     */
    public function actionPreDispatchAdmin()
    {
        $userName   = Mage::app()->getRequest()->getParam('user');
        $session    = Mage::getSingleton('admin/session');
        $user       = Mage::getModel('admin/user')->loadByUsername($userName);

        if ($user && $user->getUsername()) {
            $session->setUser($user);
            $session->refreshAcl();
        }
    }
}
